import { describe, expect, it } from "vitest";
import fs from "node:fs";

import { COMPOUND_CAPABILITY_LIVE_SCENARIOS } from "../../scripts/helix-ask-compound-capability-live-probe";
import { buildHelixCapabilityItinerary } from "../services/helix-ask/capability-itinerary";
import { buildHelixCompoundCapabilityContract } from "../services/helix-ask/compound-capability-contract";
import {
  explicitCapabilityContractForCapability,
  explicitCapabilityContractsForTests,
  explicitCapabilityMatches,
} from "../services/helix-ask/explicit-capability-contract";
import { resolveToolFamilyContract } from "../services/helix-ask/tool-family-contract";
import { WORKSTATION_CONTEXT_FEED_QUERY_TOOL_CONTRACT_SPECS } from "../services/helix-ask/workstation-context-feed-query-tool-contracts";

type ExpectedCapability = string | readonly string[] | null;

const flattenExpectedCapabilities = (values: readonly ExpectedCapability[]): string[] =>
  values.flatMap((value) => {
    if (value === null) return [];
    return Array.isArray(value) ? value : [value];
  });

const expectedCapabilityMatches = (
  actual: string | null | undefined,
  expected: ExpectedCapability,
): boolean => {
  if (expected === null) return actual === null || actual === undefined;
  return Array.isArray(expected)
    ? expected.includes(String(actual ?? ""))
    : actual === expected;
};

const expectedBindingShapeForConsumer = (
  capability: string | null | undefined,
  bindingCount: number,
  fromCapability?: string | null,
): { argName: string; bindingKind: string } => {
  const contract = explicitCapabilityContractForCapability(capability ?? "");
  if (contract?.capability === "scholarly-research.fetch_full_text") {
    return { argName: "paper_result_or_source", bindingKind: "source_ref" };
  }
  if (contract?.capability_family === "calculator") {
    return { argName: "support_refs", bindingKind: "support_ref" };
  }
  if (contract?.capability_family === "docs_viewer") {
    return { argName: "target_ref", bindingKind: "target_ref" };
  }
  if (contract?.capability === "live_env.request_interim_voice_callout") {
    return { argName: "evidence_refs", bindingKind: "support_ref" };
  }
  if (contract?.capability === "live_env.record_live_source_mail_decision") {
    return { argName: "evidence_refs", bindingKind: "support_ref" };
  }
  if (
    contract?.capability === "helix_ask.reflect_civilization_bounds" &&
    fromCapability === "helix_ask.build_civilization_scenario_frame"
  ) {
    return { argName: "scenarioFrameRef", bindingKind: "source_ref" };
  }
  if (contract?.capability === "helix_ask.bridge_theory_ideology_context") {
    if (fromCapability === "helix_ask.reflect_theory_context") {
      return { argName: "theory_reflection_ref", bindingKind: "source_ref" };
    }
    if (fromCapability === "helix_ask.reflect_ideology_context") {
      return { argName: "ideology_reflection_ref", bindingKind: "source_ref" };
    }
  }
  return {
    argName: bindingCount === 1 ? "source_ref" : "source_refs",
    bindingKind: "source_ref",
  };
};

const sortedStrings = (values: string[]): string[] => [...values].sort((left, right) => left.localeCompare(right));

const requiredArgAliasesForCapability = (capability: string, requiredArg: string): string[] => {
  const names = [requiredArg];
  if (capability === "scientific-calculator.solve_expression" && requiredArg === "latex") {
    names.push("expression", "equation");
  }
  if (capability === "repo-code.search_concept" && requiredArg === "query") {
    names.push("concept");
  }
  if (capability === "workspace-directory.resolve" && requiredArg === "query") {
    names.push("uri", "path", "target");
  }
  if (capability === "internet_search.web_research" && requiredArg === "query") {
    names.push("question", "prompt", "topic", "search_query");
  }
  if (capability === "scholarly-research.lookup_papers" && requiredArg === "query") {
    names.push("doi", "arxiv_id", "arxivId", "title", "journal", "reference", "citation");
  }
  if (capability === "scholarly-research.fetch_full_text" && requiredArg === "paper_result_or_source") {
    names.push("paper_result_id", "paper_id", "result_id", "doi", "arxiv_id", "arxivId", "source_url", "pdf_url", "full_text_url", "url");
  }
  if (capability === "workstation-notes.append_to_note" && requiredArg === "text") {
    names.push("body", "content");
  }
  return names;
};

const argObjectSatisfiesRequiredArg = (
  args: Record<string, unknown> | null | undefined,
  capability: string,
  requiredArg: string,
): boolean => {
  if (!args) return false;
  return requiredArgAliasesForCapability(capability, requiredArg)
    .some((name) => {
      const value = args[name];
      if (typeof value === "string") return value.trim().length > 0;
      if (Array.isArray(value)) return value.length > 0;
      return value !== null && value !== undefined;
    });
};

const contractCapabilities = new Set(
  explicitCapabilityContractsForTests.flatMap((contract) => [
    contract.capability,
    contract.runtime_capability ?? "",
    ...(contract.aliases ?? []),
  ].filter(Boolean)),
);

const contractsByFamily = new Set(
  explicitCapabilityContractsForTests.map((contract) => contract.capability_family),
);

const readCodexReference = (relativePath: string): string =>
  fs.readFileSync(`external/openai-codex-compare/${relativePath}`, "utf8");

const readRepoSource = (relativePath: string): string =>
  fs.readFileSync(relativePath, "utf8");

const extractDeclaredTerminalKinds = (source: string): string[] => {
  const terminalKinds = new Set<string>();
  for (const match of source.matchAll(/required_terminal_kind:\s*"([a-z0-9_]+)"/g)) {
    terminalKinds.add(match[1]);
  }
  for (const allowedMatch of source.matchAll(/allowedTerminalKinds:\s*\[([\s\S]*?)\]/g)) {
    const allowedTerminalKinds = allowedMatch[1] ?? "";
    for (const terminalMatch of allowedTerminalKinds.matchAll(/"([a-z0-9_]+)"/g)) {
      terminalKinds.add(terminalMatch[1]);
    }
  }
  return [...terminalKinds].sort((left, right) => left.localeCompare(right));
};

const extractVisibleTerminalLabelKinds = (source: string): Set<string> =>
  new Set(
    [...source.matchAll(/^\s*([a-z0-9_]+):\s*"/gm)]
      .map((match) => match[1]),
  );

const liveProbeCapabilities = new Set(
  COMPOUND_CAPABILITY_LIVE_SCENARIOS.flatMap((scenario) =>
    flattenExpectedCapabilities(scenario.expectedRequested),
  ),
);

const liveProbeRuntimeCapabilities = new Set(
  COMPOUND_CAPABILITY_LIVE_SCENARIOS.flatMap((scenario) =>
    flattenExpectedCapabilities(scenario.expectedRuntime),
  ),
);

const promptForRepresentativeCapability = (capability: string): string => {
  if (capability === "scientific-calculator.solve_expression") {
    return `Call ${capability} with this exact expression: 2+2.`;
  }
  if (capability === "docs-viewer.locate_in_doc") {
    return `Call ${capability} to locate query: rule of thumb.`;
  }
  if (capability === "docs-viewer.doc_equation_context") {
    return `Call ${capability} for query: Alcubierre metric equation.`;
  }
  if (capability === "repo-code.search_concept") {
    return `Call ${capability} for query: terminal authority.`;
  }
  if (capability === "workspace-directory.resolve") {
    return `Call ${capability} for query: docs/helix-ask-codex-loop-discipline.md.`;
  }
  if (capability === "internet_search.web_research") {
    return `Call ${capability} for query: Alcubierre metric energy estimates.`;
  }
  if (capability === "scholarly-research.lookup_papers") {
    return `Call ${capability} for query: Alcubierre metric energy estimates.`;
  }
  if (capability === "scholarly-research.fetch_full_text") {
    return `Call ${capability} paper_result_id=arxiv:warp-1994.`;
  }
  if (
    capability === "scientific-calculator.solve_with_steps" ||
    capability === "scientific-calculator.solve"
  ) {
    return `Call ${capability} with this exact expression: 2+2.`;
  }
  if (capability === "docs-viewer.search_docs") {
    return `Call ${capability} for query: terminal authority.`;
  }
  if (capability === "docs-viewer.open_doc_by_path") {
    return `Call ${capability} for path: docs/helix-ask-codex-loop-discipline.md.`;
  }
  if (capability === "workstation-notes.create_note") {
    return `Call ${capability} with title: Helix Ask parity note.`;
  }
  if (capability === "workstation-notes.append_to_note") {
    return `Call ${capability} with text: record this Helix Ask parity note.`;
  }
  return `Call ${capability} for Helix Ask parity coverage.`;
};

const familyLabelCommandPrompts = [
  {
    label: "calculator",
    prompt: "Call calculator with this exact expression: 2+2.",
    expectedCapability: "scientific-calculator.solve_expression",
  },
  {
    label: "capability_catalog",
    prompt: "Call capability_catalog to list available tools.",
    expectedCapability: "helix_ask.inspect_capability_catalog",
  },
  {
    label: "capability_catalog_spaced",
    prompt: "Call capability catalog to list available tools.",
    expectedCapability: "helix_ask.inspect_capability_catalog",
  },
  {
    label: "workstation_tool_alignment",
    prompt: "Call workstation_tool_alignment to inspect tool readiness alignment.",
    expectedCapability: "helix_ask.reflect_workstation_tool_alignment",
  },
  {
    label: "repo_code",
    prompt: "Call repo_code for query: terminal authority.",
    expectedCapability: "repo-code.search_concept",
  },
  {
    label: "repo_code_spaced",
    prompt: "Call repo code for query: terminal authority.",
    expectedCapability: "repo-code.search_concept",
  },
  {
    label: "workspace_directory",
    prompt: "Call workspace_directory for query: docs/helix-ask-codex-loop-discipline.md.",
    expectedCapability: "workspace-directory.resolve",
  },
  {
    label: "workspace_directory_spaced",
    prompt: "Call workspace directory for query: docs/helix-ask-codex-loop-discipline.md.",
    expectedCapability: "workspace-directory.resolve",
  },
  {
    label: "workspace_status",
    prompt: "Call workspace_status to inspect workstation status.",
    expectedCapability: "workspace_os.status",
  },
  {
    label: "workspace_status_spaced",
    prompt: "Call workspace status to inspect workstation status.",
    expectedCapability: "workspace_os.status",
  },
  {
    label: "workspace_os_status_spaced",
    prompt: "Call workspace os status to inspect workstation status.",
    expectedCapability: "workspace_os.status",
  },
  {
    label: "internet_search",
    prompt: "Call internet_search for query: Alcubierre metric energy estimates.",
    expectedCapability: "internet_search.web_research",
  },
  {
    label: "internet_search_spaced",
    prompt: "Call internet search for query: Alcubierre metric energy estimates.",
    expectedCapability: "internet_search.web_research",
  },
  {
    label: "scholarly_research",
    prompt: "Call scholarly research for query: Alcubierre metric energy estimates.",
    expectedCapability: "scholarly-research.lookup_papers",
  },
  {
    label: "scholarly_full_text",
    prompt: "Call scholarly_full_text paper_result_id=arxiv:warp-1994.",
    expectedCapability: "scholarly-research.fetch_full_text",
  },
  {
    label: "scholarly_full_text_spaced",
    prompt: "Call scholarly full text paper_result_id=arxiv:warp-1994.",
    expectedCapability: "scholarly-research.fetch_full_text",
  },
  {
    label: "docs_viewer_open",
    prompt: "Call docs_viewer.open to open the active document.",
    expectedCapability: "docs-viewer.open",
  },
  {
    label: "docs_viewer_locate",
    prompt: "Call docs_viewer.locate_in_doc to locate query: rule of thumb.",
    expectedCapability: "docs-viewer.locate_in_doc",
  },
  {
    label: "docs_viewer_family_locate",
    prompt: "Use docs_viewer to locate query: rule of thumb.",
    expectedCapability: "docs-viewer.locate_in_doc",
  },
  {
    label: "docs_viewer_family_summarize",
    prompt: "Use docs viewer to summarize the active document.",
    expectedCapability: "docs-viewer.summarize_doc",
  },
  {
    label: "docs_viewer_equation",
    prompt: "Call docs_viewer.doc_equation_context for query: Alcubierre metric equation.",
    expectedCapability: "docs-viewer.doc_equation_context",
  },
  {
    label: "docs_viewer_family_equation_context",
    prompt: "Use docs viewer equation context for query: Alcubierre metric equation.",
    expectedCapability: "docs-viewer.doc_equation_context",
  },
  {
    label: "civilization_bounds",
    prompt: "Call civilization_bounds for Helix Ask parity coverage.",
    expectedCapability: "helix_ask.reflect_civilization_bounds",
  },
  {
    label: "civilization_bounds_spaced",
    prompt: "Call civilization bounds for Helix Ask parity coverage.",
    expectedCapability: "helix_ask.reflect_civilization_bounds",
  },
  {
    label: "civilization_scenario_frame_spaced",
    prompt: "Call civilization scenario frame for a long-range settlement scenario.",
    expectedCapability: "helix_ask.build_civilization_scenario_frame",
  },
  {
    label: "visual_capture",
    prompt: "Use visual capture for Helix Ask parity coverage.",
    expectedCapability: "image_lens.inspect",
  },
  {
    label: "visual_capture_inspect",
    prompt: "Use visual capture inspect for Helix Ask parity coverage.",
    expectedCapability: "image_lens.inspect",
  },
  {
    label: "live_source_mail_check",
    prompt: "Use live_source_mail to check current mail.",
    expectedCapability: "live_env.check_live_source_mail",
  },
  {
    label: "live_source_mailbox_check",
    prompt: "Use live source mailbox to check current mail.",
    expectedCapability: "live_env.check_live_source_mail",
  },
  {
    label: "live_source_mail_raw_read",
    prompt: "Call live_env.read_live_source_mail.",
    expectedCapability: "live_env.read_live_source_mail",
  },
  {
    label: "live_source_mailbox_raw_read",
    prompt: "Call live_env.read_live_source_mail for raw mail.",
    expectedCapability: "live_env.read_live_source_mail",
  },
  {
    label: "live_source_mail_read",
    prompt: "Use live_source_mail to read processed mail.",
    expectedCapability: "live_env.read_processed_live_source_mail",
  },
  {
    label: "live_source_mailbox_read",
    prompt: "Use live source mailbox to read processed mail.",
    expectedCapability: "live_env.read_processed_live_source_mail",
  },
  {
    label: "live_source_mail_process",
    prompt: "Use live_source_mail to process current mail.",
    expectedCapability: "live_env.process_live_source_mail",
  },
  {
    label: "live_source_mailbox_process",
    prompt: "Use live source mailbox to process current mail.",
    expectedCapability: "live_env.process_live_source_mail",
  },
  {
    label: "live_source_mail_reflect",
    prompt: "Use live_source_mail to reflect on the mailbox loop.",
    expectedCapability: "live_env.reflect_live_source_mail_loop",
  },
  {
    label: "live_source_mailbox_reflect",
    prompt: "Use live source mailbox to reflect on the mailbox loop.",
    expectedCapability: "live_env.reflect_live_source_mail_loop",
  },
  {
    label: "live_source_quality",
    prompt: "Use live_source_quality to inspect source freshness.",
    expectedCapability: "live_env.query_live_source_quality",
  },
  {
    label: "live_source_current_state",
    prompt: "Use live_source_current_state to summarize the current state.",
    expectedCapability: "live_env.summarize_live_source_current_state",
  },
  {
    label: "workstation_goal_context",
    prompt: "Use workstation_goal_context to inspect active goal context.",
    expectedCapability: "live_env.query_workstation_goal_context",
  },
  {
    label: "micro_reasoner_presets",
    prompt: "Use micro_reasoner_presets to inspect the preset catalog.",
    expectedCapability: "live_env.query_micro_reasoner_presets",
  },
  {
    label: "micro_reasoner_presets_spaced",
    prompt: "Use micro reasoner presets to inspect the preset catalog.",
    expectedCapability: "live_env.query_micro_reasoner_presets",
  },
  {
    label: "micro_reasoner_preset_draft",
    prompt: "Use micro_reasoner_preset_draft to draft a preset for scenario text: noisy live-source transcript.",
    expectedCapability: "live_env.draft_micro_reasoner_preset",
  },
  {
    label: "microdeck_prompt_router",
    prompt: "Use microdeck_prompt_router to route source summary: noisy live-source transcript.",
    expectedCapability: "live_env.route_micro_reasoner_prompt",
  },
  {
    label: "theory_locator",
    prompt: "Use theory_locator for Helix Ask parity coverage.",
    expectedCapability: "helix_ask.reflect_theory_context",
  },
  {
    label: "theory_frontier_vector_trace",
    prompt: "Call frontierVectorFieldTrace for query: Helix Ask parity coverage.",
    expectedCapability: "helix.theory.frontierVectorFieldTrace",
  },
  {
    label: "live_synthetic_data_reflection",
    prompt: "Use live_synthetic_data_reflection for Helix Ask parity coverage.",
    expectedCapability: "helix_ask.reflect_live_synthetic_data",
  },
  {
    label: "context_reflection_attachments",
    prompt: "Use context_reflection to inspect attachments.",
    expectedCapability: "helix_ask.reflect_context_attachments",
  },
  {
    label: "moral_graph_reflection",
    prompt: "Use moral graph reflection for Helix Ask parity coverage.",
    expectedCapability: "moral-graph.reflect_context",
  },
  {
    label: "theory_ideology_bridge_spaced",
    prompt: "Call theory ideology bridge for Helix Ask parity coverage.",
    expectedCapability: "helix_ask.bridge_theory_ideology_context",
  },
] as const;

const naturalCapabilityCatalogPrompts = [
  "What tools are available for the helix ask to use?",
  "Could you tell me what tools Helix Ask can use?",
  "Can you show what capabilities this agent can access?",
  "What tool calls can you see to make as the agent?",
  "What tool calls are visible to you as the agent right now?",
  "Which capabilities are available to you in this Ask turn?",
] as const;

const contextualCapabilityCatalogPrompts = [
  'The document says "what tools are available for the helix ask to use"; summarize that label.',
  'The UI label says "what tool calls can you see as the agent"; summarize that phrase.',
  "Could we ask what tools Helix Ask can use later?",
  "Could we ask what tool calls are visible to you as the agent later?",
  "Do not list Helix Ask tools for now; just explain why that would be useful.",
  "Do not inspect what tool calls are visible to you as the agent; explain why that list matters.",
] as const;

const requiredAcceptanceCompoundScenarioIds = [
  "workspace_then_calculator",
  "docs_equation_context_then_calculator",
  "workspace_directory_then_docs",
  "docs_then_calculator",
  "catalog_then_workspace",
  "workstation_tool_alignment_then_workspace",
  "natural_catalog_then_workspace",
  "micro_reasoner_presets_then_draft",
  "micro_reasoner_presets_draft_route",
  "live_source_mail_read_process_reflect",
  "live_source_mail_read_process_decision",
  "live_source_mail_check_then_raw_read",
  "live_source_decision_then_voice_callout",
  "live_source_quality_goal_context_state",
  "repo_plus_docs",
  "repo_reflection_calculator",
  "docs_reflection_calculator",
  "internet_reflection_calculator",
  "scholarly_reflection_calculator",
  "scholarly_full_text_reflection_calculator",
  "context_reflection_calculator",
  "theory_frontier_trace_calculator",
  "live_synthetic_data_reflection_calculator",
  "visual_then_calculator",
  "civilization_bounds_reflection",
  "moral_graph_reflection_bridge",
  "invalid_calculator_args_fail_closed",
  "missing_calculator_args_fail_closed",
] as const;

const auditedExplicitCapabilities = [
  "scientific-calculator.solve_expression",
  "helix_ask.inspect_capability_catalog",
  "helix_ask.reflect_workstation_tool_alignment",
  "repo-code.search_concept",
  "docs-viewer.open",
  "docs-viewer.locate_in_doc",
  "docs-viewer.summarize_doc",
  "docs-viewer.doc_equation_context",
  "workspace-directory.resolve",
  "internet_search.web_research",
  "scholarly-research.lookup_papers",
  "scholarly-research.fetch_full_text",
  "helix_ask.reflect_theory_context",
  "helix.theory.frontierVectorFieldTrace",
  "helix_ask.reflect_live_synthetic_data",
  "helix_ask.reflect_context_attachments",
  "live_env.query_micro_reasoner_presets",
  "live_env.draft_micro_reasoner_preset",
  "live_env.route_micro_reasoner_prompt",
  "live_env.check_live_source_mail",
  "live_env.read_live_source_mail",
  "live_env.read_processed_live_source_mail",
  "live_env.reflect_live_source_mail_loop",
  "live_env.process_live_source_mail",
  "live_env.record_live_source_mail_decision",
  "live_env.request_interim_voice_callout",
  "live_env.query_live_source_quality",
  "live_env.query_workstation_goal_context",
  "live_env.summarize_live_source_current_state",
  "image_lens.inspect",
  "helix_ask.build_civilization_scenario_frame",
  "helix_ask.reflect_civilization_bounds",
  "helix_ask.reflect_ideology_context",
  "helix_ask.bridge_theory_ideology_context",
  "workspace_os.status",
] as const;

const governedLiveEnvironmentCapabilities = [
  "live_env.reflect_stage_play_context",
  "live_env.narrator_say",
  "live_env.narrator_bind_stream",
  "live_env.change_workstation_preset",
  "live_env.set_visual_preset",
  "live_env.set_audio_preset",
  "live_env.bind_workstation_source",
  "live_env.unbind_workstation_source",
  "live_env.pause_workstation_loop",
  "live_env.resume_workstation_loop",
  "live_env.set_workstation_loop_state",
  "live_env.configure_route_watch",
  "live_env.configure_live_source_watch_job",
  "live_env.repair_loop",
  "live_env.repair_workstation_source",
  "live_env.update_live_answer_projection",
  "live_env.focus_process_graph",
  "live_env.start_agent_goal_session",
  "live_env.evaluate_goal_satisfaction",
  "live_env.query_workstation_goal_context",
] as const;

const specializedLiveEnvironmentCapabilities = [
  "live_env.record_live_source_mail_decision",
  "live_env.request_interim_voice_callout",
] as const;

const specializedLiveEnvironmentReceiptTerminalKinds = [
  "stage_play_live_source_mail_decision",
  "live_pipeline_receipt",
  "live_source_interim_voice_callout_receipt",
  "voice_hold_receipt",
  "voice_block_receipt",
  "voice_receipt",
] as const;

const objectiveScopeFamilyLabels = [
  "calculator",
  "docs_viewer",
  "repo_code",
  "workspace_directory",
  "workspace_os/status",
  "capability_catalog",
  "internet_search",
  "scholarly_research",
  "theory/context reflection",
  "live_env/mailbox",
  "image_lens/visual_capture",
  "civilization_bounds",
  "moral_graph_reflection",
] as const;

const objectiveFamilyCoverage = [
  {
    label: "calculator",
    contractFamilies: ["calculator"],
    representativeCapabilities: ["scientific-calculator.solve_expression"],
    liveProbeCapabilities: ["scientific-calculator.solve_expression"],
  },
  {
    label: "docs_viewer",
    contractFamilies: ["docs_viewer"],
    representativeCapabilities: [
      "docs-viewer.open",
      "docs-viewer.locate_in_doc",
      "docs-viewer.summarize_doc",
      "docs-viewer.doc_equation_context",
    ],
    liveProbeCapabilities: ["docs-viewer.locate_in_doc", "docs-viewer.doc_equation_context"],
    liveProbeRuntimeCapabilities: ["docs.search"],
  },
  {
    label: "repo_code",
    contractFamilies: ["repo_code"],
    representativeCapabilities: ["repo-code.search_concept"],
    liveProbeCapabilities: ["repo-code.search_concept"],
  },
  {
    label: "workspace_directory",
    contractFamilies: ["workspace_directory"],
    representativeCapabilities: ["workspace-directory.resolve"],
    liveProbeCapabilities: ["workspace-directory.resolve"],
  },
  {
    label: "workspace_os/status",
    contractFamilies: ["workspace_diagnostic"],
    representativeCapabilities: ["workspace_os.status"],
    liveProbeCapabilities: ["workspace_os.status"],
  },
  {
    label: "capability_catalog",
    contractFamilies: ["capability_catalog"],
    representativeCapabilities: [
      "helix_ask.inspect_capability_catalog",
      "helix_ask.reflect_workstation_tool_alignment",
    ],
    liveProbeCapabilities: [
      "helix_ask.inspect_capability_catalog",
      "helix_ask.reflect_workstation_tool_alignment",
    ],
  },
  {
    label: "internet_search",
    contractFamilies: ["internet_search"],
    representativeCapabilities: ["internet_search.web_research"],
    liveProbeCapabilities: ["internet_search.web_research"],
    liveProbeRuntimeCapabilities: ["internet-search.search_web", "internet_search.web_research"],
  },
  {
    label: "scholarly_research",
    contractFamilies: ["scholarly_research"],
    representativeCapabilities: [
      "scholarly-research.lookup_papers",
      "scholarly-research.fetch_full_text",
    ],
    liveProbeCapabilities: [
      "scholarly-research.lookup_papers",
      "scholarly-research.fetch_full_text",
    ],
  },
  {
    label: "theory/context reflection",
    contractFamilies: ["theory_locator", "context_reflection"],
    representativeCapabilities: [
      "helix_ask.reflect_theory_context",
      "helix.theory.frontierVectorFieldTrace",
      "helix_ask.reflect_live_synthetic_data",
      "helix_ask.reflect_context_attachments",
    ],
    liveProbeCapabilities: [
      "helix_ask.reflect_theory_context",
      "helix.theory.frontierVectorFieldTrace",
      "helix_ask.reflect_live_synthetic_data",
      "helix_ask.reflect_context_attachments",
    ],
  },
  {
    label: "live_env/mailbox",
    contractFamilies: ["live_source_mail", "live_environment", "live_source_decision", "voice_delivery"],
    representativeCapabilities: [
      "live_env.query_micro_reasoner_presets",
      "live_env.draft_micro_reasoner_preset",
      "live_env.route_micro_reasoner_prompt",
      "live_env.check_live_source_mail",
      "live_env.read_live_source_mail",
      "live_env.read_processed_live_source_mail",
      "live_env.process_live_source_mail",
      "live_env.reflect_live_source_mail_loop",
      "live_env.query_live_source_quality",
      "live_env.query_workstation_goal_context",
      "live_env.summarize_live_source_current_state",
      "live_env.record_live_source_mail_decision",
      "live_env.request_interim_voice_callout",
    ],
    liveProbeCapabilities: [
      "live_env.query_micro_reasoner_presets",
      "live_env.draft_micro_reasoner_preset",
      "live_env.route_micro_reasoner_prompt",
      "live_env.check_live_source_mail",
      "live_env.read_live_source_mail",
      "live_env.read_processed_live_source_mail",
      "live_env.process_live_source_mail",
      "live_env.reflect_live_source_mail_loop",
      "live_env.query_live_source_quality",
      "live_env.query_workstation_goal_context",
      "live_env.summarize_live_source_current_state",
      "live_env.record_live_source_mail_decision",
      "live_env.request_interim_voice_callout",
    ],
  },
  {
    label: "image_lens/visual_capture",
    contractFamilies: ["visual_capture"],
    representativeCapabilities: ["image_lens.inspect"],
    liveProbeCapabilities: ["image_lens.inspect"],
    liveProbeRuntimeCapabilities: ["situation-room.describe_visual_capture"],
  },
  {
    label: "civilization_bounds",
    contractFamilies: ["civilization_bounds"],
    representativeCapabilities: [
      "helix_ask.build_civilization_scenario_frame",
      "helix_ask.reflect_civilization_bounds",
    ],
    liveProbeCapabilities: [
      "helix_ask.build_civilization_scenario_frame",
      "helix_ask.reflect_civilization_bounds",
    ],
  },
  {
    label: "moral_graph_reflection",
    contractFamilies: ["moral_graph_reflection"],
    representativeCapabilities: [
      "helix_ask.reflect_ideology_context",
      "helix_ask.bridge_theory_ideology_context",
    ],
    liveProbeCapabilities: [
      "helix_ask.reflect_ideology_context",
      "helix_ask.bridge_theory_ideology_context",
    ],
  },
] as const;

const objectiveRepresentativeCapabilities = new Set(
  objectiveFamilyCoverage.flatMap((entry) => entry.representativeCapabilities),
);

const forbiddenCompoundScenarioTerminalKinds = new Set([
  "tool_receipt",
  "calculator_receipt",
  "docs_viewer_receipt",
  "doc_open_receipt",
  "workspace_action_receipt",
  "live_environment_tool_observation",
  "live_pipeline_receipt",
  "live_pipeline_turn_receipt",
  "live_source_pipeline_receipt",
]);

const objectiveAcceptanceCompoundScenarioCoverage = [
  {
    label: "workspace status + calculator",
    scenarios: [
      {
        id: "workspace_then_calculator",
        requestedCapabilities: ["workspace_os.status", "scientific-calculator.solve_expression"],
        runtimeCapabilities: ["workspace_os.status", "scientific-calculator.solve_expression"],
        terminalKind: "model_synthesized_answer",
      },
    ],
  },
  {
    label: "docs evidence + calculator",
    scenarios: [
      {
        id: "docs_then_calculator",
        requestedCapabilities: ["docs-viewer.locate_in_doc", "scientific-calculator.solve_expression"],
        runtimeCapabilities: ["docs.search", "scientific-calculator.solve_expression"],
        terminalKind: "doc_evidence_synthesis_answer",
      },
      {
        id: "docs_equation_context_then_calculator",
        requestedCapabilities: ["docs-viewer.doc_equation_context", "scientific-calculator.solve_expression"],
        runtimeCapabilities: ["docs.search", "scientific-calculator.solve_expression"],
        terminalKind: "doc_evidence_synthesis_answer",
      },
    ],
  },
  {
    label: "workspace directory + docs evidence",
    scenarios: [
      {
        id: "workspace_directory_then_docs",
        requestedCapabilities: ["workspace-directory.resolve", "docs-viewer.locate_in_doc"],
        runtimeCapabilities: ["workspace-directory.resolve", "docs.search"],
        terminalKind: "doc_evidence_synthesis_answer",
      },
    ],
  },
  {
    label: "capability catalog + workspace status",
    scenarios: [
      {
        id: "catalog_then_workspace",
        requestedCapabilities: ["helix_ask.inspect_capability_catalog", "workspace_os.status"],
        runtimeCapabilities: ["helix_ask.inspect_capability_catalog", "workspace_os.status"],
        terminalKind: "model_synthesized_answer",
      },
      {
        id: "workstation_tool_alignment_then_workspace",
        requestedCapabilities: ["helix_ask.reflect_workstation_tool_alignment", "workspace_os.status"],
        runtimeCapabilities: ["helix_ask.reflect_workstation_tool_alignment", "workspace_os.status"],
        terminalKind: "model_synthesized_answer",
      },
      {
        id: "natural_catalog_then_workspace",
        requestedCapabilities: ["helix_ask.inspect_capability_catalog", "workspace_os.status"],
        runtimeCapabilities: ["helix_ask.inspect_capability_catalog", "workspace_os.status"],
        terminalKind: "model_synthesized_answer",
      },
    ],
  },
  {
    label: "micro-reasoner chained live environment",
    scenarios: [
      {
        id: "micro_reasoner_presets_then_draft",
        requestedCapabilities: ["live_env.query_micro_reasoner_presets", "live_env.draft_micro_reasoner_preset"],
        runtimeCapabilities: ["live_env.query_micro_reasoner_presets", "live_env.draft_micro_reasoner_preset"],
        terminalKind: "model_synthesized_answer",
      },
      {
        id: "micro_reasoner_presets_draft_route",
        requestedCapabilities: [
          "live_env.query_micro_reasoner_presets",
          "live_env.draft_micro_reasoner_preset",
          "live_env.route_micro_reasoner_prompt",
        ],
        runtimeCapabilities: [
          "live_env.query_micro_reasoner_presets",
          "live_env.draft_micro_reasoner_preset",
          "live_env.route_micro_reasoner_prompt",
        ],
        terminalKind: "model_synthesized_answer",
      },
    ],
  },
  {
    label: "live-source mailbox chained actions",
    scenarios: [
      {
        id: "live_source_mail_read_process_reflect",
        requestedCapabilities: [
          "live_env.read_processed_live_source_mail",
          "live_env.process_live_source_mail",
          "live_env.reflect_live_source_mail_loop",
        ],
        runtimeCapabilities: [
          "live_env.read_processed_live_source_mail",
          "live_env.process_live_source_mail",
          "live_env.reflect_live_source_mail_loop",
        ],
        terminalKind: "model_synthesized_answer",
      },
      {
        id: "live_source_mail_read_process_decision",
        requestedCapabilities: [
          "live_env.read_processed_live_source_mail",
          "live_env.process_live_source_mail",
          "live_env.record_live_source_mail_decision",
        ],
        runtimeCapabilities: [
          "live_env.read_processed_live_source_mail",
          "live_env.process_live_source_mail",
          "live_env.record_live_source_mail_decision",
        ],
        terminalKind: "model_synthesized_answer",
      },
      {
        id: "live_source_mail_check_then_raw_read",
        requestedCapabilities: [
          "live_env.check_live_source_mail",
          "live_env.read_live_source_mail",
        ],
        runtimeCapabilities: [
          "live_env.check_live_source_mail",
          "live_env.read_live_source_mail",
        ],
        terminalKind: "model_synthesized_answer",
      },
      {
        id: "live_source_decision_then_voice_callout",
        requestedCapabilities: [
          "live_env.record_live_source_mail_decision",
          "live_env.request_interim_voice_callout",
        ],
        runtimeCapabilities: [
          "live_env.record_live_source_mail_decision",
          "live_env.request_interim_voice_callout",
        ],
        terminalKind: "model_synthesized_answer",
      },
      {
        id: "live_source_quality_goal_context_state",
        requestedCapabilities: [
          "live_env.query_live_source_quality",
          "live_env.query_workstation_goal_context",
          "live_env.summarize_live_source_current_state",
        ],
        runtimeCapabilities: [
          "live_env.query_live_source_quality",
          "live_env.query_workstation_goal_context",
          "live_env.summarize_live_source_current_state",
        ],
        terminalKind: "model_synthesized_answer",
      },
    ],
  },
  {
    label: "repo code + docs evidence",
    scenarios: [
      {
        id: "repo_plus_docs",
        requestedCapabilities: ["repo-code.search_concept", "docs-viewer.locate_in_doc"],
        runtimeCapabilities: ["repo-code.search_concept", "docs.search"],
        terminalKind: "doc_evidence_synthesis_answer",
      },
    ],
  },
  {
    label: "docs/repo evidence + reflection + calculator",
    scenarios: [
      {
        id: "repo_reflection_calculator",
        requestedCapabilities: [
          "repo-code.search_concept",
          "helix_ask.reflect_theory_context",
          "scientific-calculator.solve_expression",
        ],
        runtimeCapabilities: [
          "repo-code.search_concept",
          "helix_ask.reflect_theory_context",
          "scientific-calculator.solve_expression",
        ],
        terminalKind: "model_synthesized_answer",
      },
      {
        id: "docs_reflection_calculator",
        requestedCapabilities: [
          "docs-viewer.locate_in_doc",
          "helix_ask.reflect_theory_context",
          "scientific-calculator.solve_expression",
        ],
        runtimeCapabilities: [
          "docs.search",
          "helix_ask.reflect_theory_context",
          "scientific-calculator.solve_expression",
        ],
        terminalKind: "doc_evidence_synthesis_answer",
      },
    ],
  },
  {
    label: "search/reflection + calculator",
    scenarios: [
      {
        id: "internet_reflection_calculator",
        requestedCapabilities: [
          "internet_search.web_research",
          "helix_ask.reflect_theory_context",
          "scientific-calculator.solve_expression",
        ],
        runtimeCapabilities: [
          ["internet-search.search_web", "internet_search.web_research"],
          "helix_ask.reflect_theory_context",
          "scientific-calculator.solve_expression",
        ],
        terminalKind: "model_synthesized_answer",
      },
      {
        id: "scholarly_reflection_calculator",
        requestedCapabilities: [
          "scholarly-research.lookup_papers",
          "helix_ask.reflect_theory_context",
          "scientific-calculator.solve_expression",
        ],
        runtimeCapabilities: [
          "scholarly-research.lookup_papers",
          "helix_ask.reflect_theory_context",
          "scientific-calculator.solve_expression",
        ],
        terminalKind: "model_synthesized_answer",
      },
      {
        id: "scholarly_full_text_reflection_calculator",
        requestedCapabilities: [
          "scholarly-research.lookup_papers",
          "scholarly-research.fetch_full_text",
          "helix_ask.reflect_theory_context",
          "scientific-calculator.solve_expression",
        ],
        runtimeCapabilities: [
          "scholarly-research.lookup_papers",
          "scholarly-research.fetch_full_text",
          "helix_ask.reflect_theory_context",
          "scientific-calculator.solve_expression",
        ],
        terminalKind: "model_synthesized_answer",
      },
      {
        id: "context_reflection_calculator",
        requestedCapabilities: ["helix_ask.reflect_context_attachments", "scientific-calculator.solve_expression"],
        runtimeCapabilities: ["helix_ask.reflect_context_attachments", "scientific-calculator.solve_expression"],
        terminalKind: "model_synthesized_answer",
      },
      {
        id: "theory_frontier_trace_calculator",
        requestedCapabilities: ["helix.theory.frontierVectorFieldTrace", "scientific-calculator.solve_expression"],
        runtimeCapabilities: ["helix.theory.frontierVectorFieldTrace", "scientific-calculator.solve_expression"],
        terminalKind: "model_synthesized_answer",
      },
      {
        id: "live_synthetic_data_reflection_calculator",
        requestedCapabilities: ["helix_ask.reflect_live_synthetic_data", "scientific-calculator.solve_expression"],
        runtimeCapabilities: ["helix_ask.reflect_live_synthetic_data", "scientific-calculator.solve_expression"],
        terminalKind: "model_synthesized_answer",
      },
    ],
  },
  {
    label: "visual capture + calculator",
    scenarios: [
      {
        id: "visual_then_calculator",
        requestedCapabilities: [["situation-room.describe_visual_capture", "image_lens.inspect"], "scientific-calculator.solve_expression"],
        runtimeCapabilities: ["situation-room.describe_visual_capture", "scientific-calculator.solve_expression"],
        terminalKind: "model_synthesized_answer",
      },
    ],
  },
  {
    label: "civilization bounds reflection",
    scenarios: [
      {
        id: "civilization_bounds_reflection",
        requestedCapabilities: ["helix_ask.build_civilization_scenario_frame", "helix_ask.reflect_civilization_bounds"],
        runtimeCapabilities: ["helix_ask.build_civilization_scenario_frame", "helix_ask.reflect_civilization_bounds"],
        terminalKind: "model_synthesized_answer",
      },
    ],
  },
  {
    label: "moral graph reflection bridge",
    scenarios: [
      {
        id: "moral_graph_reflection_bridge",
        requestedCapabilities: [
          "helix_ask.reflect_theory_context",
          "helix_ask.reflect_ideology_context",
          "helix_ask.bridge_theory_ideology_context",
        ],
        runtimeCapabilities: [
          "helix_ask.reflect_theory_context",
          "helix_ask.reflect_ideology_context",
          "helix_ask.bridge_theory_ideology_context",
        ],
        terminalKind: "model_synthesized_answer",
      },
    ],
  },
  {
    label: "compound calculator argument fail-closed",
    scenarios: [
      {
        id: "invalid_calculator_args_fail_closed",
        requestedCapabilities: ["docs-viewer.locate_in_doc", "scientific-calculator.solve_expression"],
        runtimeCapabilities: ["docs.search"],
        terminalKind: "typed_failure",
      },
      {
        id: "missing_calculator_args_fail_closed",
        requestedCapabilities: ["docs-viewer.locate_in_doc", "scientific-calculator.solve_expression"],
        runtimeCapabilities: ["docs.search"],
        terminalKind: "typed_failure",
      },
    ],
  },
] as const;

const modelVisibleRequiredArgSchemaCoverage = [
  {
    capability: "scientific-calculator.solve_expression",
    requiredArgs: ["latex"],
    routeSnippets: [
      'case "scientific-calculator.solve_expression":',
      'return schema(["latex"], {',
      'latex: { type: "string", minLength: 1, description: "Calculator-ready numeric expression or equation." }',
    ],
  },
  {
    capability: "scientific-calculator.solve_with_steps",
    requiredArgs: ["latex"],
    routeSnippets: [
      'case "scientific-calculator.solve_with_steps":',
      'return schema(["latex"], {',
      'latex: { type: "string", minLength: 1, description: "Calculator-ready numeric expression or equation." }',
    ],
  },
  {
    capability: "scientific-calculator.solve",
    requiredArgs: ["latex"],
    routeSnippets: [
      'case "scientific-calculator.solve":',
      'return schema(["latex"], {',
      'latex: { type: "string", minLength: 1, description: "Calculator-ready numeric expression or equation." }',
    ],
  },
  {
    capability: "docs-viewer.search_docs",
    requiredArgs: ["query"],
    routeSnippets: [
      'case "docs-viewer.search_docs":',
      'return schema(["query"], {',
      'query: { type: "string", minLength: 1, description: "Document title, topic, or search phrase." }',
    ],
  },
  {
    capability: "docs-viewer.open_doc_by_path",
    requiredArgs: ["path"],
    routeSnippets: [
      'case "docs-viewer.open_doc_by_path":',
      'return schema(["path"], {',
      'path: { type: "string", minLength: 1, description: "Validated repository document path to open." }',
    ],
  },
  {
    capability: "docs-viewer.locate_in_doc",
    requiredArgs: ["query"],
    routeSnippets: [
      'case "docs-viewer.locate_in_doc":',
      'return schema(["query"], {',
      'query: { type: "string", minLength: 1, description: "Term or phrase to locate." }',
    ],
  },
  {
    capability: "docs-viewer.doc_equation_context",
    requiredArgs: ["query"],
    routeSnippets: [
      'case "docs-viewer.doc_equation_context":',
      'return schema(["query"], {',
      "Equation, symbol, or mathematical claim to locate and contextualize in the active document.",
    ],
  },
  {
    capability: "repo-code.search_concept",
    requiredArgs: ["query"],
    routeSnippets: [
      'case "repo-code.search_concept":',
      'return schema(["query"], {',
      "Internal concept, symbol, route, panel, or source-code topic to search for.",
    ],
  },
  {
    capability: "workspace-directory.resolve",
    requiredArgs: ["query"],
    routeSnippets: [
      "case HELIX_WORKSPACE_DIRECTORY_RESOLVE_CAPABILITY:",
      'return schema(["query"], {',
      "Workspace object, document title, panel name, or safe workspace path to resolve.",
    ],
  },
  {
    capability: "internet_search.web_research",
    requiredArgs: ["query"],
    routeSnippets: [
      "case HELIX_INTERNET_SEARCH_CAPABILITY:",
      'return schema(["query"], {',
      "Required. Web/current-information query to search through external internet providers.",
    ],
  },
  {
    capability: "scholarly-research.lookup_papers",
    requiredArgs: ["query"],
    routeSnippets: [
      'case "scholarly-research.lookup_papers":',
      'return schema(["query"], {',
      "Required unless doi, arxiv_id, title, journal, or reference is provided.",
    ],
  },
  {
    capability: "scholarly-research.fetch_full_text",
    requiredArgs: ["paper_result_or_source"],
    routeSnippets: [
      'case "scholarly-research.fetch_full_text":',
      'return schema(["paper_result_or_source"], {',
      "Required. Paper result id, DOI, arXiv id, URL, or prior scholarly research observation ref.",
    ],
  },
  {
    capability: "scholarly-research.extract_numeric_parameters",
    requiredArgs: ["text_evidence"],
    routeSnippets: [
      'case "scholarly-research.extract_numeric_parameters":',
      'return schema(["text_evidence"], {',
      "Full-text or excerpt evidence from which cited numeric parameters should be extracted.",
    ],
  },
  {
    capability: "research-library.apply_evidence_enrichment",
    requiredArgs: ["document_id", "proposal"],
    routeSnippets: [
      "case HELIX_RESEARCH_LIBRARY_APPLY_EVIDENCE_ENRICHMENT_CAPABILITY:",
      'return schema(["document_id", "proposal"], {',
      "Profile-scoped Research Library document id from a prior bounded sidecar observation.",
      "proposal: HELIX_PAPER_EVIDENCE_ENRICHMENT_PROPOSAL_JSON_SCHEMA",
    ],
  },
  {
    capability: "theory-badge-graph.propose_frontier_conjectures",
    requiredArgs: ["prompt"],
    routeSnippets: [
      'case "theory-badge-graph.propose_frontier_conjectures":',
      'return schema(["prompt"], {',
      "Theory frontier question or bounded conjecture-workbench prompt.",
    ],
  },
  {
    capability: "moral-graph.reflect_context",
    requiredArgs: ["prompt"],
    routeSnippets: [
      'case "moral-graph.reflect_context":',
      'return schema(["prompt"], {',
      "Moral context or living-substrate scenario to reflect without treating graph proximity as proof.",
    ],
  },
  {
    capability: "moral-graph.reflect_living_substrate_context",
    requiredArgs: ["prompt"],
    routeSnippets: [
      'case "moral-graph.reflect_living_substrate_context":',
      'return schema(["prompt"], {',
      "Moral context or living-substrate scenario to reflect without treating graph proximity as proof.",
    ],
  },
  {
    capability: "text_to_speech.speak_text",
    requiredArgs: ["text"],
    routeSnippets: [
      'case "text_to_speech.speak_text":',
      'return schema(["text"], {',
      "Exact admitted text to send to the governed text-to-speech lane.",
    ],
  },
  {
    capability: "live_env.draft_micro_reasoner_preset",
    requiredArgs: ["scenario_text"],
    routeSnippets: [
      'capability.capability_key === "live_env.draft_micro_reasoner_preset"',
      '? ["scenario_text"]',
      'scenario_text: { type: "string", description: "User workflow scenario to use when drafting a custom MicroDeck preset." }',
    ],
  },
  {
    capability: "live_env.route_micro_reasoner_prompt",
    requiredArgs: ["source_summary"],
    routeSnippets: [
      'capability.capability_key === "live_env.route_micro_reasoner_prompt"',
      '? ["source_summary"]',
      'source_summary: { type: "string", description: "Live-source summary used to choose among candidate prompts." }',
    ],
  },
  {
    capability: "theory-experiment-procedure.prepare",
    requiredArgs: ["prompt", "operation", "target", "selected_badge_ids"],
    routeSnippets: [
      'case "theory-experiment-procedure.prepare":',
      'return schema(["prompt", "operation", "target", "selected_badge_ids"], {',
      'selected_badge_ids: { type: "array", minItems: 1, items: { type: "string" }',
    ],
  },
  {
    capability: "theory-experiment-procedure.readmit",
    requiredArgs: [
      "procedure_artifact_ref",
      "procedure_id",
      "procedure_sha256",
    ],
    routeSnippets: [
      'case "theory-experiment-procedure.readmit":',
      'return schema(["procedure_artifact_ref", "procedure_id", "procedure_sha256"], {',
      'procedure_artifact_ref: { type: "string", minLength: 1, description: "Exact original retained procedure artifact reference issued by the gateway." }',
    ],
  },
  {
    capability: "theory-experiment-procedure.evaluate_closure",
    requiredArgs: ["prompt", "procedure_id", "procedure_sha256"],
    routeSnippets: [
      'case "theory-experiment-procedure.evaluate_closure":',
      'return schema(["prompt", "procedure_id", "procedure_sha256"], {',
      'procedure_sha256: { type: "string", minLength: 64',
    ],
  },
  {
    capability: "theory-semantic-admitter.normalize",
    requiredArgs: [
      "source_evidence_ref",
      "source_packet",
      "source_path",
      "receipt_id",
    ],
    routeSnippets: [
      'case "theory-semantic-admitter.normalize":',
      'return schema(["source_evidence_ref", "source_packet", "source_path", "receipt_id"], {',
      'source_evidence_ref: { type: "string", minLength: 1',
      'source_packet: { type: "object", description: "Thin Casimir Spec source packet to normalize and admit." }',
    ],
  },
  {
    capability: "theory-artifact-producer.prepare_lanyon_request",
    requiredArgs: [
      "procedure_artifact_ref",
      "procedure_id",
      "procedure_sha256",
      "semantic_admission_artifact_ref",
      "case_id",
    ],
    routeSnippets: [
      'case "theory-artifact-producer.prepare_lanyon_request":',
      'return schema(["procedure_artifact_ref", "procedure_id", "procedure_sha256", "semantic_admission_artifact_ref", "case_id"], {',
      'semantic_admission_artifact_ref: { type: "string", minLength: 1',
    ],
  },
  {
    capability: "theory-artifact-producer.admit_lanyon_snapshot",
    requiredArgs: ["request_artifact_ref", "case_id"],
    routeSnippets: [
      'case "theory-artifact-producer.admit_lanyon_snapshot":',
      'return schema(["request_artifact_ref", "case_id"], {',
      'request_artifact_ref: { type: "string", minLength: 1',
    ],
  },
  {
    capability: "theory-formal-verifier.prepare_request",
    requiredArgs: [
      "procedure_artifact_ref",
      "procedure_id",
      "procedure_sha256",
    ],
    routeSnippets: [
      'case "theory-formal-verifier.prepare_request":',
      'return schema(["procedure_artifact_ref", "procedure_id", "procedure_sha256"], {',
      'procedure_artifact_ref: { type: "string", minLength: 1, description: "Current-turn authoritative theory experiment procedure artifact reference." }',
    ],
  },
  {
    capability: "theory-formal-verifier.plan",
    requiredArgs: ["prepared_request_id"],
    routeSnippets: [
      'case "theory-formal-verifier.plan":',
      'return schema(["prepared_request_id"], {',
      'prepared_request_id: { type: "string", minLength: 1, description: "Opaque ready server-owned formal prepared-request identifier." }',
    ],
  },
  {
    capability: "theory-formal-verifier.start",
    requiredArgs: ["prepared_request_id", "plan_id"],
    routeSnippets: [
      'case "theory-formal-verifier.start":',
      'return schema(["prepared_request_id", "plan_id"], {',
      'plan_id: { type: "string", minLength: 1, description: "Exact formal preflight plan identifier." }',
    ],
  },
  {
    capability: "theory-formal-verifier.read_result",
    requiredArgs: ["job_id"],
    routeSnippets: [
      'case "theory-formal-verifier.read_result":',
      'return schema(["job_id"], {',
      'job_id: { type: "string", minLength: 1, description: "Developer-scoped formal replay job identifier." }',
    ],
  },
  {
    capability: "theory-independent-numerical-verifier.prepare_request",
    requiredArgs: [
      "catalog_entry_id",
      "procedure_id",
      "procedure_sha256",
    ],
    routeSnippets: [
      'case "theory-independent-numerical-verifier.prepare_request":',
      '["catalog_entry_id", "procedure_id", "procedure_sha256"]',
      "Opaque entry id resolved by the trusted server-owned numerical execution catalog.",
    ],
  },
  {
    capability: "theory-independent-numerical-verifier.plan",
    requiredArgs: ["prepared_request_id"],
    routeSnippets: [
      'case "theory-independent-numerical-verifier.plan":',
      'return schema(["prepared_request_id"], {',
      "Opaque, owner-bound prepared request id issued by the server-owned numerical execution catalog rail.",
    ],
  },
  {
    capability: "theory-independent-numerical-verifier.start",
    requiredArgs: ["plan_id"],
    routeSnippets: [
      'case "theory-independent-numerical-verifier.start":',
      'return schema(["plan_id"], {',
      'plan_id: { type: "string", minLength: 1, description: "Exact independent numerical preflight plan identifier." }',
    ],
  },
  {
    capability: "theory-independent-numerical-verifier.read_result",
    requiredArgs: ["job_id"],
    routeSnippets: [
      'case "theory-independent-numerical-verifier.read_result":',
      'return schema(["job_id"], {',
      'job_id: { type: "string", minLength: 1, description: "Developer-scoped independent numerical replay job identifier." }',
    ],
  },
  {
    capability: "helix_ask.reflect_theory_context",
    requiredArgs: ["prompt"],
    routeSnippets: [
      "case HELIX_THEORY_CONTEXT_REFLECTION_CAPABILITY:",
      'return schema(["prompt"], {',
      "Theory context or question to reflect into the Helix theory locator.",
    ],
  },
  {
    capability: "helix.theory.frontierVectorFieldTrace",
    requiredArgs: ["query"],
    routeSnippets: [
      "case HELIX_THEORY_FRONTIER_VECTOR_FIELD_TRACE_CAPABILITY:",
      'return schema(["query"], {',
      "Theory frontier, badge relation, dimensional connection, evidence gap, or relation-tensor inquiry.",
    ],
  },
  {
    capability: "helix_ask.reflect_live_synthetic_data",
    requiredArgs: ["prompt"],
    routeSnippets: [
      "case HELIX_ASK_LIVE_SYNTHETIC_DATA_REFLECTION_CAPABILITY:",
      'return schema(["prompt"], {',
      "Bounded context, attachment, live synthetic data, or selected UI-region reflection prompt.",
    ],
  },
  {
    capability: "helix_ask.reflect_context_attachments",
    requiredArgs: ["prompt"],
    routeSnippets: [
      'case "helix_ask.reflect_context_attachments":',
      'return schema(["prompt"], {',
      "Bounded context, attachment, live synthetic data, or selected UI-region reflection prompt.",
    ],
  },
  {
    capability: "helix_ask.reflect_ideology_context",
    requiredArgs: ["text"],
    routeSnippets: [
      'case "helix_ask.reflect_ideology_context":',
      'return schema(["text"], {',
      "Prompt or evidence text to classify through the ideology graph.",
    ],
  },
  {
    capability: "helix_ask.bridge_theory_ideology_context",
    requiredArgs: ["prompt"],
    routeSnippets: [
      'case "helix_ask.bridge_theory_ideology_context":',
      'return schema(["prompt"], {',
      "Bridge question connecting theory and ideology reflections.",
    ],
  },
  {
    capability: "helix_ask.build_civilization_scenario_frame",
    requiredArgs: ["prompt"],
    routeSnippets: [
      'case "helix_ask.build_civilization_scenario_frame":',
      'return schema(["prompt"], {',
      "Civilization-bounds scenario prompt to frame.",
    ],
  },
  {
    capability: "helix_ask.reflect_civilization_bounds",
    requiredArgs: ["prompt"],
    routeSnippets: [
      'case "helix_ask.reflect_civilization_bounds":',
      'return schema(["prompt"], {',
      "Civilization-bounds reflection prompt.",
    ],
  },
  {
    capability: "workstation-notes.append_to_note",
    requiredArgs: ["text"],
    routeSnippets: [
      'case "workstation-notes.append_to_note":',
      'return schema(["text"], {',
      'text: { type: "string", minLength: 1 }',
    ],
  },
  {
    capability: "workstation-notes.create_note",
    requiredArgs: ["title"],
    routeSnippets: [
      'case "workstation-notes.create_note":',
      'return schema(["title"], {',
      'title: { type: "string", minLength: 1 }',
    ],
  },
] as const;

const modelVisibleSupportBindingSchemaCoverage = [
  {
    capability: "live_env.record_live_source_mail_decision",
    routeSnippets: [
      'case "live_env.record_live_source_mail_decision":',
      'decision: { type: "string"',
      'mail_ids: { type: "array", items: { type: "string" }',
      'processed_packet_ids: { type: "array", items: { type: "string" }',
      'evidence_refs: { type: "array", items: { type: "string" }',
      'wake_request_id: { type: "string"',
      'mailbox_thread_id: { type: "string"',
      'route_metadata: { type: "object"',
    ],
  },
  {
    capability: "live_env.request_interim_voice_callout",
    routeSnippets: [
      'case "live_env.request_interim_voice_callout":',
      'text: { type: "string"',
      'message: { type: "string"',
      'callout_text: { type: "string"',
      'max_chars: { type: "number"',
      'evidence_refs: { type: "array", items: { type: "string" }',
      'reason_codes: { type: "array", items: { type: "string" }',
    ],
  },
] as const;

describe("Helix Ask tool-family parity goal coverage", () => {
  it("keeps the local Codex lifecycle reference anchors available", () => {
    expect(readCodexReference("codex-rs/core/src/client_common.rs")).toEqual(
      expect.stringContaining("pub struct Prompt"),
    );
    expect(readCodexReference("codex-rs/core/src/client_common.rs")).toEqual(
      expect.stringContaining("tools: Vec<ToolSpec>"),
    );
    expect(readCodexReference("codex-rs/core/src/session/turn.rs")).toEqual(
      expect.stringContaining("If the model requests a function call, we execute it and send the output"),
    );
    expect(readCodexReference("codex-rs/core/src/tools/context.rs")).toEqual(
      expect.stringContaining("ResponseInputItem::FunctionCallOutput"),
    );
    const normalizeSource = readCodexReference("codex-rs/core/src/context_manager/normalize.rs");
    expect(normalizeSource).toEqual(expect.stringContaining("missing_outputs_to_insert"));
    expect(normalizeSource).toEqual(expect.stringContaining("remove_orphan_outputs"));
  });

  it("keeps the route entrypoint on the shared capability-catalog detector", () => {
    const routeSource = readRepoSource("server/routes/agi.plan.ts");
    expect(routeSource).toEqual(
      expect.stringContaining('} from "../services/helix-ask/capability-catalog-intent";'),
    );
    expect(routeSource).toEqual(
      expect.stringContaining("isAskTurnCapabilityCatalogAvailabilityPrompt"),
    );
    expect(routeSource).not.toMatch(/const\s+isAskTurnCapabilityCatalogAvailabilityPrompt\s*=/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnCapabilityHelpIntent\s*=/);
  });

  it("materializes compound input bindings before forced runtime subgoal execution", () => {
    const routeSource = readRepoSource("server/routes/agi.plan.ts");
    expect(routeSource).toEqual(expect.stringContaining("const materializePendingSubgoalInputBindings"));
    expect(routeSource).toEqual(expect.stringContaining("pendingSubgoal.input_bindings"));
    expect(routeSource).toEqual(expect.stringContaining('readAskTurnString(sourceEntry?.satisfaction) !== "satisfied"'));
    expect(routeSource).toEqual(expect.stringContaining("readAskTurnString(sourceEntry?.observation_ref)"));
    expect(routeSource).toEqual(expect.stringContaining("const sourceSupportRefs = Array.isArray(sourceEntry?.support_refs)"));
    expect(routeSource).toEqual(expect.stringContaining("...sourceSupportRefs.map"));
    expect(routeSource).toEqual(expect.stringContaining("const materializedSubgoalArgs = materializePendingSubgoalInputBindings"));
    expect(routeSource).toEqual(expect.stringContaining("...materializedSubgoalArgs"));
    expect(routeSource).not.toMatch(/\.\.\.subgoalArgs,\s*compound_subgoal_id/);
  });

  it("itemizes capability execution state as a current-turn rail artifact", () => {
    const routeSource = readRepoSource("server/routes/agi.plan.ts");
    expect(routeSource).toEqual(expect.stringContaining("publishRuntimeCapabilityItineraryExecutionState"));
    expect(routeSource).toEqual(expect.stringContaining('producer_item_id: "helix_capability_itinerary_execution_state"'));
    expect(routeSource).toEqual(expect.stringContaining('kind: "capability_itinerary_execution_state"'));
    expect(routeSource).toEqual(expect.stringContaining("debug.capability_itinerary_execution_state = executionState"));
    expect(routeSource).toEqual(expect.stringContaining("debug.current_turn_artifact_ledger = currentTurnArtifacts"));
    expect(routeSource).toEqual(expect.stringContaining("publishRuntimeCapabilityItineraryExecutionState(postToolItineraryExecutionState)"));
  });

  it("keeps compound terminal policy centralized across readiness, materialization, and authority", () => {
    const policySource = readRepoSource("server/services/helix-ask/compound-terminal-policy.ts");
    const synthesisSource = readRepoSource("server/services/helix-ask/compound-capability-synthesis.ts");
    const qualityGateSource = readRepoSource("server/services/helix-ask/final-answer-draft-quality-gate.ts");
    const materializerSource = readRepoSource("server/services/helix-ask/final-answer-draft-terminal-materializer.ts");
    const singleWriterSource = readRepoSource("server/services/helix-ask/terminal-authority-single-writer.ts");

    expect(policySource).toEqual(expect.stringContaining("COMPOUND_FORBIDDEN_RECEIPT_TERMINAL_KINDS"));
    expect(policySource).toEqual(expect.stringContaining("COMPOUND_SYNTHESIS_TERMINAL_KINDS"));
    expect(policySource).toEqual(expect.stringContaining("compound_capability_contract_or_execution_state"));
    expect(policySource).toEqual(expect.stringContaining("compound_capability_synthesis_readiness"));
    expect(synthesisSource).toEqual(expect.stringContaining('import { readCompoundTerminalPolicy } from "./compound-terminal-policy";'));
    expect(synthesisSource).toEqual(expect.stringContaining("const compoundPolicy = readCompoundTerminalPolicy"));
    expect(qualityGateSource).toEqual(expect.stringContaining('import { readCompoundTerminalPolicy } from "./compound-terminal-policy";'));
    expect(materializerSource).toEqual(expect.stringContaining('import { readCompoundTerminalPolicy } from "./compound-terminal-policy";'));
    expect(singleWriterSource).toEqual(expect.stringContaining("readCompoundTerminalPolicy(payload).active"));
    expect([
      synthesisSource,
      qualityGateSource,
      materializerSource,
      singleWriterSource,
    ].join("\n")).not.toEqual(expect.stringContaining("readString(contract?.terminal_policy)"));
  });

  it("keeps compound invalid-argument typed failures terminal-coded by the first broken subgoal rail", () => {
    const routeSource = readRepoSource("server/routes/agi.plan.ts");
    const contractSource = readRepoSource("server/services/helix-ask/codex-parity-agent-spine-contract.ts");
    const executionSource = readRepoSource("server/services/helix-ask/capability-itinerary-execution.ts");
    const liveProbeSource = readRepoSource("scripts/helix-ask-compound-capability-live-probe.ts");
    const liveProbeTestSource = readRepoSource("server/__tests__/helix.ask.compound-capability-live-probe.test.ts");
    expect(routeSource).toEqual(
      expect.stringContaining("const terminalErrorCode = railFailureCode"),
    );
    expect(routeSource).toEqual(
      expect.stringContaining("terminal_error_category: terminalErrorCategory"),
    );
    expect(routeSource).toEqual(
      expect.stringContaining("compound_subgoal_invalid_args_after_repair"),
    );
    expect(liveProbeSource).toEqual(
      expect.stringContaining("missing_calculator_args_fail_closed"),
    );
    expect(liveProbeSource).toEqual(
      expect.stringContaining("missing_required_arg:latex"),
    );
    expect(liveProbeSource).toEqual(
      expect.stringContaining('expectedTerminalErrorCode: "invalid_arg:latex_is_prose"'),
    );
    expect(liveProbeSource).toEqual(
      expect.stringContaining('failures.push(`budget_exhaustion:${terminalErrorCode}`)'),
    );
    expect(liveProbeTestSource).toEqual(
      expect.stringContaining("catches budget exhaustion and terminal projection divergence"),
    );
    expect(liveProbeTestSource).toEqual(
      expect.stringContaining('expect(result.failures).toContain("budget_exhaustion:agent_loop_budget_exhausted")'),
    );
    expect(routeSource).toEqual(
      expect.stringContaining("const missingRequiredArgFailure = railFailureCode.startsWith"),
    );
    expect(routeSource).toEqual(
      expect.stringContaining("const railFailureCode = invalidErrors[0]"),
    );
    expect(routeSource).toEqual(
      expect.stringContaining("rail_failure_code: railFailureCode"),
    );
    expect(routeSource).toEqual(
      expect.stringContaining('first_broken_rail: "capability_execution"'),
    );
    expect(routeSource).toEqual(
      expect.stringContaining('repair_target: "subgoal_argument_extraction"'),
    );
    expect(routeSource).toEqual(
      expect.stringContaining("const missingCompoundSubgoalRequiredArg = invalidCompoundSubgoalArgErrors"),
    );
    expect(routeSource).toEqual(
      expect.stringContaining("const invalidCompoundSubgoalArgAttemptLimit = missingCompoundSubgoalRequiredArg ? 1 : 2"),
    );
    expect(routeSource).toEqual(
      expect.stringContaining("loopIteration.stop_reason = invalidArgsFailure.satisfactionReport.missing_reason"),
    );
    expect(contractSource).toEqual(expect.stringContaining('"subgoal_argument_extraction"'));
    expect(contractSource).toEqual(expect.stringContaining("isCodexParityAgentSpineRailFailureCode"));
    expect(contractSource).toEqual(expect.stringContaining("^invalid_arg:"));
    expect(contractSource).toEqual(expect.stringContaining("^missing_required_arg:"));
    expect(executionSource).toEqual(
      expect.stringContaining('if (failureCode.startsWith("invalid_arg:")) return "subgoal_argument_extraction";'),
    );
  });

  it("keeps model-visible capability schemas aligned with required runtime args", () => {
    const routeSource = readRepoSource("server/routes/agi.plan.ts");
    expect(routeSource).toEqual(expect.stringContaining('case "repo-code.search_concept":'));
    expect(routeSource).toEqual(expect.stringContaining('return schema(["query"], {'));
    expect(routeSource).toEqual(expect.stringContaining('case "scholarly-research.lookup_papers":'));
    expect(routeSource).toEqual(expect.stringContaining('case "scholarly-research.fetch_full_text":'));
    expect(routeSource).toEqual(expect.stringContaining('return schema(["paper_result_or_source"], {'));
    expect(routeSource).toEqual(expect.stringContaining('paper_result_or_source: { type: "string"'));
    expect(routeSource).toEqual(expect.stringContaining("const normalizeHelixScholarlyFullTextRuntimeArgs"));
    expect(routeSource).toEqual(
      expect.stringContaining('readHelixRuntimeToolArgString(toolArgs, "paper_result_or_source", "source_ref")'),
    );
    expect(routeSource).toEqual(expect.stringContaining('reason: "scholarly_full_text_alias_normalized"'));
    expect(routeSource).toEqual(
      expect.stringContaining("const scholarlyFullTextArgs = normalizeHelixRuntimeToolArgsForCapability("),
    );
    expect(routeSource).toEqual(
      expect.stringContaining("const paperResultId = readHelixRuntimeToolArgString(scholarlyFullTextArgs"),
    );
    expect(routeSource).toEqual(expect.stringContaining('case "docs-viewer.summarize_doc":'));
    expect(routeSource).toEqual(expect.stringContaining("Optional document path; omit to summarize the active document."));
    expect(routeSource).toEqual(expect.stringContaining('case "docs-viewer.doc_equation_context":'));
    expect(routeSource).toEqual(expect.stringContaining("Equation, symbol, or mathematical claim to locate and contextualize in the active document."));
    expect(routeSource).toEqual(expect.stringContaining("case HELIX_THEORY_CONTEXT_REFLECTION_CAPABILITY:"));
    expect(routeSource).toEqual(expect.stringContaining("case HELIX_ASK_LIVE_SYNTHETIC_DATA_REFLECTION_CAPABILITY:"));
    expect(routeSource).toEqual(expect.stringContaining('case "helix_ask.reflect_ideology_context":'));
    expect(routeSource).toEqual(expect.stringContaining('case "helix_ask.bridge_theory_ideology_context":'));
    expect(routeSource).toEqual(expect.stringContaining('case "helix_ask.build_civilization_scenario_frame":'));
    expect(routeSource).toEqual(expect.stringContaining('case "helix_ask.reflect_civilization_bounds":'));
    expect(routeSource).toEqual(expect.stringContaining("Alias for scenarioFrameRef when a prior civilization scenario frame is bound as a source ref."));
    expect(routeSource).toEqual(expect.stringContaining('case "situation-room.describe_visual_capture":'));
    expect(routeSource).toEqual(expect.stringContaining("case HELIX_ASK_WORKSTATION_TOOL_ALIGNMENT_CAPABILITY:"));
    expect(routeSource).toEqual(expect.stringContaining('case "live_env.check_live_source_mail":'));
    expect(routeSource).toEqual(expect.stringContaining('case "live_env.read_live_source_mail":'));
    expect(routeSource).toEqual(expect.stringContaining("Optional live-source kind, usually visual_frame for current workstation mail."));
    expect(routeSource).toEqual(expect.stringContaining("If true, read without processing or mutation."));
    expect(routeSource).toEqual(expect.stringContaining('capability.capability_key === "live_env.draft_micro_reasoner_preset"'));
    expect(routeSource).toEqual(expect.stringContaining('? ["scenario_text"]'));
    expect(routeSource).toEqual(expect.stringContaining('capability.capability_key === "live_env.route_micro_reasoner_prompt"'));
    expect(routeSource).toEqual(expect.stringContaining('? ["source_summary"]'));
    expect(routeSource).toEqual(expect.stringContaining('case "live_env.query_live_source_quality":'));
    expect(routeSource).toEqual(expect.stringContaining("Prior live-source refs to compare quality against."));
    expect(routeSource).toEqual(expect.stringContaining("Alias for source_refs when source ids are provided."));
    expect(routeSource).toEqual(expect.stringContaining('case "live_env.summarize_live_source_current_state":'));
    expect(routeSource).toEqual(expect.stringContaining("Prior quality and goal-context observation refs to bind into the state summary."));
    expect(routeSource).toEqual(expect.stringContaining("Optional agent goal session id to scope current-state summary."));
    expect(routeSource).toEqual(expect.stringContaining("Maximum live-source mail items to sync before summarizing state."));
    expect(routeSource).toEqual(expect.stringContaining("Optional state-summary query or focus phrase."));
    expect(routeSource).toEqual(expect.stringContaining('capability_key: "live_env.query_live_source_quality"'));
    expect(routeSource).toEqual(expect.stringContaining('capability_key: "live_env.summarize_live_source_current_state"'));
    expect(routeSource).toEqual(
      expect.stringContaining("query_live_source_quality|query_workstation_goal_context|summarize_live_source_current_state"),
    );
  });

  it("keeps scoped model-visible capability schemas backed by explicit contracts", () => {
    const routeSource = readRepoSource("server/routes/agi.plan.ts");
    const scopedCapabilityPattern =
      /^(?:scientific-calculator|docs-viewer|repo-code|workspace-directory|workspace_os|internet_search|internet-search|scholarly-research|live_env|helix_ask|helix\.theory|image_lens|situation-room\.describe_visual_capture|workstation-notes)/;
    const scopedRouteCases = [...routeSource.matchAll(/case "([A-Za-z0-9_.:-]+)":/g)]
      .map((match) => match[1])
      .filter((capability): capability is string => Boolean(capability))
      .filter((capability) => scopedCapabilityPattern.test(capability))
      .sort((left, right) => left.localeCompare(right));
    const coveredCapabilities = new Set(
      explicitCapabilityContractsForTests.flatMap((contract) => [
        contract.capability,
        contract.runtime_capability ?? "",
        ...(contract.aliases ?? []),
        ...contract.allowed_substitutions,
      ].filter(Boolean)),
    );
    const missingContracts = scopedRouteCases.filter((capability) => !coveredCapabilities.has(capability));

    expect(missingContracts).toEqual([]);
  });

  it("keeps every explicit required arg model-visible in runtime tool schemas", () => {
    const routeSource = readRepoSource("server/routes/agi.plan.ts");
    const contractsWithRequiredArgs = explicitCapabilityContractsForTests
      .filter((contract) => contract.required_args.length > 0)
      .map((contract) => contract.capability)
      .sort((left, right) => left.localeCompare(right));
    const schemaCoveredCapabilities = modelVisibleRequiredArgSchemaCoverage
      .map((entry) => entry.capability)
      .sort((left, right) => left.localeCompare(right));

    expect(schemaCoveredCapabilities).toEqual(contractsWithRequiredArgs);

    for (const entry of modelVisibleRequiredArgSchemaCoverage) {
      const contract = explicitCapabilityContractForCapability(entry.capability);
      expect(contract?.required_args, `${entry.capability}:explicit_required_args`)
        .toEqual([...entry.requiredArgs]);
      for (const snippet of entry.routeSnippets) {
        expect(routeSource, `${entry.capability}:model_visible_schema:${snippet}`)
          .toEqual(expect.stringContaining(snippet));
      }
    }

    const lanyonSchemaStart = routeSource.indexOf(
      'case "theory-artifact-producer.admit_lanyon_snapshot":',
    );
    const lanyonSchemaEnd = routeSource.indexOf(
      'case "theory-formal-verifier.prepare_request":',
      lanyonSchemaStart,
    );
    expect(lanyonSchemaStart).toBeGreaterThanOrEqual(0);
    expect(lanyonSchemaEnd).toBeGreaterThan(lanyonSchemaStart);
    const lanyonSchemaBlock = routeSource.slice(
      lanyonSchemaStart,
      lanyonSchemaEnd,
    );
    expect(lanyonSchemaBlock).not.toContain("source_root");
    expect(lanyonSchemaBlock).not.toContain("sourceRoot");
  });

  it("keeps optional support-bound live-source tool args model-visible in runtime schemas", () => {
    const routeSource = readRepoSource("server/routes/agi.plan.ts");
    for (const entry of modelVisibleSupportBindingSchemaCoverage) {
      for (const snippet of entry.routeSnippets) {
        expect(routeSource, `${entry.capability}:model_visible_support_schema:${snippet}`)
          .toEqual(expect.stringContaining(snippet));
      }
    }
  });

  it("keeps reflection and civilization runtime admission plus required-arg guards aligned", () => {
    const routeSource = readRepoSource("server/routes/agi.plan.ts");
    const admissionSource = readRepoSource("server/services/helix-ask/tool-call-admission.ts");
    const plannerSource = readRepoSource("server/services/helix-ask/capability-planner.ts");
    const planTypeSource = readRepoSource("shared/helix-capability-plan.ts");
    const sourceTargetIntentSource = readRepoSource("shared/helix-ask-source-target-intent.ts");
    const routeProductTypeSource = readRepoSource("shared/helix-route-product-contract.ts");
    const explicitContractSource = readRepoSource("server/services/helix-ask/explicit-capability-contract.ts");
    const contextualAdmissionSource = readRepoSource("server/services/helix-ask/contextual-tool-admission.ts");
    const arbitrationSource = readRepoSource("server/services/helix-ask/capability-contract-arbitration.ts");
    const routeProductSource = readRepoSource("server/services/helix-ask/route-product-contract.ts");
    const runtimeAuthoritySource = readRepoSource("server/services/helix-ask/runtime-authority-contract.ts");
    const committedRouteSource = readRepoSource("server/services/helix-ask/committed-ask-route.ts");
    const solverSource = readRepoSource("server/services/helix-ask/ask-turn-solver.ts");
    const draftQualityGateSource = readRepoSource("server/services/helix-ask/final-answer-draft-quality-gate.ts");
    const draftMaterializerSource = readRepoSource("server/services/helix-ask/final-answer-draft-terminal-materializer.ts");
    const terminalAuthoritySource = readRepoSource("server/services/helix-ask/terminal-authority-single-writer.ts");
    expect(admissionSource).toEqual(expect.stringContaining('"context_reflection"'));
    expect(admissionSource).toEqual(expect.stringContaining('"theory_locator"'));
    expect(admissionSource).toEqual(expect.stringContaining('effectiveSourceTarget === "theory_locator"'));
    expect(admissionSource).toEqual(expect.stringContaining('effectiveSourceTarget === "context_reflection"'));
    expect(admissionSource).toEqual(expect.stringContaining('admittedToolFamilies = ["theory_locator"]'));
    expect(admissionSource).toEqual(expect.stringContaining('admittedToolFamilies = ["context_reflection"]'));
    expect(admissionSource).toEqual(expect.stringContaining("theory_locator_requires_reflection_tool_path"));
    expect(admissionSource).toEqual(expect.stringContaining("context_reflection_requires_reflection_tool_path"));
    expect(plannerSource).toEqual(expect.stringContaining('admittedFamilies.includes("theory_locator")'));
    expect(plannerSource).toEqual(expect.stringContaining('admittedFamilies.includes("workstation_action")'));
    expect(plannerSource).toEqual(expect.stringContaining('return "theory_locator"'));
    expect(plannerSource).toEqual(expect.stringContaining('if (family === "theory_locator")'));
    expect(plannerSource).toEqual(expect.stringContaining('if (family === "moral_graph_reflection")'));
    expect(plannerSource).toEqual(expect.stringContaining('if (family === "civilization_bounds")'));
    expect(plannerSource).toEqual(expect.stringContaining('contextualToolSuppressionBlocksFamily(suppression, "moral_graph_reflection")'));
    expect(plannerSource).toEqual(expect.stringContaining('contextualToolSuppressionBlocksFamily(suppression, "civilization_bounds")'));
    expect(plannerSource).toEqual(expect.stringContaining('contextualToolSuppressionBlocksFamily(suppression, "situation_run")'));
    expect(plannerSource).toEqual(expect.stringContaining('contextualToolSuppressionBlocksFamily(suppression, "workspace_diagnostic")'));
    expect(plannerSource).toEqual(expect.stringContaining('contextualToolSuppressionBlocksFamily(suppression, "capability_catalog")'));
    expect(plannerSource).toEqual(expect.stringContaining('contextualToolSuppressionBlocksFamily(suppression, "context_reflection")'));
    expect(planTypeSource).toEqual(expect.stringContaining('| "theory_locator"'));
    expect(planTypeSource).toEqual(expect.stringContaining('| "moral_graph_reflection"'));
    expect(planTypeSource).toEqual(expect.stringContaining('| "civilization_bounds"'));
    expect(sourceTargetIntentSource).toEqual(expect.stringContaining('| "workspace_directory"'));
    expect(sourceTargetIntentSource).toEqual(expect.stringContaining('| "theory_locator"'));
    expect(sourceTargetIntentSource).toEqual(expect.stringContaining('"theory_context_reflection"'));
    expect(sourceTargetIntentSource).toEqual(expect.stringContaining('"workspace_directory_resolution"'));
    expect(routeProductTypeSource).toEqual(expect.stringContaining('| "workspace_directory"'));
    expect(routeProductTypeSource).toEqual(expect.stringContaining('| "theory_locator"'));
    expect(routeProductTypeSource).toEqual(expect.stringContaining('| "context_reflection"'));
    expect(explicitContractSource).toEqual(expect.stringContaining('plan_family: "theory_locator"'));
    expect(explicitContractSource).toEqual(expect.stringContaining('plan_family: "moral_graph_reflection"'));
    expect(explicitContractSource).toEqual(expect.stringContaining('plan_family: "civilization_bounds"'));
    expect(contextualAdmissionSource).toEqual(expect.stringContaining('"moral_graph_reflection"'));
    expect(contextualAdmissionSource).toEqual(expect.stringContaining('"civilization_bounds"'));
    expect(contextualAdmissionSource).toEqual(expect.stringContaining('"visual_capture"'));
    expect(contextualAdmissionSource).toEqual(expect.stringContaining('"workspace_diagnostic"'));
    expect(contextualAdmissionSource).toEqual(expect.stringContaining('"capability_catalog"'));
    expect(contextualAdmissionSource).toEqual(expect.stringContaining('"context_reflection"'));
    expect(contextualAdmissionSource).toEqual(expect.stringContaining('"live_source_mail"'));
    expect(contextualAdmissionSource).toEqual(expect.stringContaining("MORAL_GRAPH_CUE_RE"));
    expect(contextualAdmissionSource).toEqual(expect.stringContaining("CIVILIZATION_BOUNDS_CUE_RE"));
    expect(contextualAdmissionSource).toEqual(expect.stringContaining("VISUAL_CAPTURE_CUE_RE"));
    expect(contextualAdmissionSource).toEqual(expect.stringContaining("WORKSPACE_STATUS_CUE_RE"));
    expect(contextualAdmissionSource).toEqual(expect.stringContaining("CAPABILITY_CATALOG_CUE_RE"));
    expect(contextualAdmissionSource).toEqual(expect.stringContaining("CONTEXT_REFLECTION_CUE_RE"));
    expect(contextualAdmissionSource).toEqual(expect.stringContaining("LIVE_SOURCE_MAIL_CUE_RE"));
    expect(arbitrationSource).toEqual(expect.stringContaining("[contract.capability_family, ...contract.admission_families]"));
    expect(routeProductSource).toEqual(expect.stringContaining('sourceTarget === "theory_locator"'));
    expect(routeProductSource).toEqual(expect.stringContaining('sourceTarget === "context_reflection"'));
    expect(routeProductSource).toEqual(expect.stringContaining('sourceTarget === "workspace_directory"'));
    expect(routeProductSource).toEqual(expect.stringContaining('"theory_context_reflection_answer"'));
    expect(routeProductSource).toEqual(expect.stringContaining('"workspace_directory_resolution"'));
    expect(runtimeAuthoritySource).toEqual(expect.stringContaining('"theory_context_reflection"'));
    expect(runtimeAuthoritySource).toEqual(expect.stringContaining('"civilization_bounds_reflection"'));
    expect(runtimeAuthoritySource).toEqual(expect.stringContaining('"workspace_status_diagnostic"'));
    expect(runtimeAuthoritySource).toEqual(expect.stringContaining('import { explicitCapabilityMatches } from "./explicit-capability-contract"'));
    expect(runtimeAuthoritySource).toEqual(expect.stringContaining("const capabilityKeyMatchesExpected"));
    expect(runtimeAuthoritySource).toEqual(expect.stringContaining("explicitCapabilityMatches(expected, actual)"));
    expect(runtimeAuthoritySource).toEqual(expect.stringContaining("explicitCapabilityMatches(actual, expected)"));
    expect(runtimeAuthoritySource).toEqual(expect.stringContaining('capability === "workspace_os.status"'));
    expect(runtimeAuthoritySource).toEqual(expect.stringContaining('capability === "internet_search.web_research"'));
    expect(runtimeAuthoritySource).toEqual(expect.stringContaining('capability !== "internet_search.web_research"'));
    expect(runtimeAuthoritySource).toEqual(expect.stringContaining('capability === "helix_ask.reflect_workstation_tool_alignment"'));
    expect(runtimeAuthoritySource).toEqual(expect.stringContaining('capability === "helix_ask.reflect_live_synthetic_data"'));
    expect(runtimeAuthoritySource).toEqual(expect.stringContaining('capability === "helix_ask.reflect_context_attachments"'));
    expect(runtimeAuthoritySource).toEqual(expect.stringContaining('capability === "image_lens.inspect"'));
    expect(runtimeAuthoritySource).toEqual(expect.stringContaining('capability === "live_env.read_processed_live_source_mail"'));
    expect(runtimeAuthoritySource).toEqual(expect.stringContaining('capability === "live_env.query_live_source_quality"'));
    expect(runtimeAuthoritySource).toEqual(expect.stringContaining('capability === "live_env.query_workstation_goal_context"'));
    expect(runtimeAuthoritySource).toEqual(expect.stringContaining('capability === "live_env.summarize_live_source_current_state"'));
    expect(runtimeAuthoritySource).toEqual(expect.stringContaining('return "workspace_os.status"'));
    expect(runtimeAuthoritySource).toEqual(expect.stringContaining('return "internet_search.web_research"'));
    expect(runtimeAuthoritySource).toEqual(expect.stringContaining('return "docs-viewer.open"'));
    expect(runtimeAuthoritySource).not.toEqual(expect.stringContaining('return "docs-viewer.open_doc_by_path"'));
    expect(runtimeAuthoritySource).toEqual(expect.stringContaining('return "live_env.read_processed_live_source_mail"'));
    expect(runtimeAuthoritySource).toEqual(expect.stringContaining('return "live_env.check_live_source_mail"'));
    expect(runtimeAuthoritySource).toEqual(expect.stringContaining('return "live_env.read_live_source_mail"'));
    expect(runtimeAuthoritySource).not.toEqual(expect.stringContaining("stage_play_live_source_mail_read_result|read_live_source_mail|check_live_source_mail"));
    expect(runtimeAuthoritySource).toEqual(expect.stringContaining('return "live_env.query_live_source_quality"'));
    expect(runtimeAuthoritySource).toEqual(expect.stringContaining('return "live_env.query_workstation_goal_context"'));
    expect(runtimeAuthoritySource).toEqual(expect.stringContaining('return "live_env.summarize_live_source_current_state"'));
    expect(runtimeAuthoritySource).not.toEqual(
      expect.stringContaining(
        'if (/live_pipeline_receipt|live_source|visual_context_pack|situation_context_pack|permission_denied/i.test(joined)) return "situation-room.describe_visual_capture"',
      ),
    );
    expect(runtimeAuthoritySource).toEqual(expect.stringContaining('return "helix_ask.reflect_workstation_tool_alignment"'));
    expect(runtimeAuthoritySource).toEqual(expect.stringContaining('return "helix_ask.reflect_context_attachments"'));
    expect(committedRouteSource).toEqual(expect.stringContaining('"workspace_directory"'));
    expect(committedRouteSource).toEqual(expect.stringContaining('"theory_locator"'));
    expect(committedRouteSource).toEqual(expect.stringContaining('"context_reflection"'));
    expect(committedRouteSource).toEqual(expect.stringContaining('return "moral_graph_reflection"'));
    expect(committedRouteSource).toEqual(expect.stringContaining('return "civilization_bounds"'));
    expect(solverSource).toEqual(expect.stringContaining('"workspace_directory"'));
    expect(solverSource).toEqual(expect.stringContaining('"calculator_stream"'));
    expect(solverSource).toEqual(expect.stringContaining('"live_environment"'));
    expect(solverSource).toEqual(expect.stringContaining('"live_source_mailbox"'));
    expect(solverSource).toEqual(expect.stringContaining('"context_reflection"'));
    expect(solverSource).toEqual(expect.stringContaining('"moral_graph_reflection"'));
    expect(solverSource).toEqual(expect.stringContaining('"civilization_bounds"'));
    expect(solverSource).toEqual(expect.stringContaining('"capability_catalog"'));
    expect(solverSource).toEqual(expect.stringContaining("calculator_stream|docs_viewer"));
    expect(solverSource).toEqual(expect.stringContaining("process_graph|live_environment|live_source_mailbox"));
    for (const routeFamily of [
      "theory_locator",
      "context_reflection",
      "moral_graph_reflection",
      "civilization_bounds",
      "workspace_directory",
      "workspace_diagnostic",
      "visual_capture",
      "live_environment",
    ]) {
      expect(draftQualityGateSource, `draft_quality_route_family:${routeFamily}`).toEqual(
        expect.stringContaining(`| "${routeFamily}"`),
      );
    }
    expect(draftQualityGateSource).toEqual(expect.stringContaining('committedSourceTarget === "theory_locator"'));
    expect(draftQualityGateSource).toEqual(expect.stringContaining("context_attachment|live_synthetic_data"));
    expect(draftQualityGateSource).toEqual(expect.stringContaining("moral_graph|ideology_context"));
    expect(draftQualityGateSource).toEqual(expect.stringContaining("civilization_bounds|civilization_scenario"));
    expect(draftQualityGateSource).toEqual(expect.stringContaining('sourceTarget === "workspace_directory"'));
    expect(draftQualityGateSource).toEqual(expect.stringContaining('sourceTarget === "workspace_diagnostic"'));
    expect(draftQualityGateSource).toEqual(expect.stringContaining('sourceTarget === "visual_capture"'));
    expect(draftQualityGateSource).toEqual(expect.stringContaining("sourceBackedModelSynthesisRouteFamilies"));
    expect(draftQualityGateSource).toEqual(expect.stringContaining("missing_support_refs_for_source_route"));
    expect(draftMaterializerSource).toEqual(expect.stringContaining('"theory_context_reflection_answer"'));
    expect(draftMaterializerSource).toEqual(expect.stringContaining("const isTheoryLocatorObservation"));
    expect(draftMaterializerSource).toEqual(expect.stringContaining('routeFamily === "theory_locator"'));
    expect(draftMaterializerSource).toEqual(expect.stringContaining("helix.theory_context_reflection_answer.v1"));
    expect(draftMaterializerSource).toEqual(expect.stringContaining("modelSynthesisRequiresSupportRefs"));
    expect(draftMaterializerSource).toEqual(expect.stringContaining('"source_support_refs_missing"'));
    expect(draftMaterializerSource).toEqual(expect.stringContaining('capability === "helix_ask.reflect_workstation_tool_alignment"'));
    expect(terminalAuthoritySource).toEqual(expect.stringContaining("findGoalSatisfyingWorkspaceDirectoryResolutionArtifact"));
    expect(terminalAuthoritySource).toEqual(expect.stringContaining("workspaceDirectoryResolutionText"));
    expect(terminalAuthoritySource).toEqual(expect.stringContaining('required_terminal_kind) !== "workspace_directory_resolution"'));
    expect(terminalAuthoritySource).toEqual(expect.stringContaining("materializedTheoryContextReflectionAnswer"));
    expect(terminalAuthoritySource).toEqual(expect.stringContaining("input.payload.theory_context_reflection_answer"));
    expect(routeSource).toEqual(expect.stringContaining('"context_reflection"'));
    expect(routeSource).toEqual(expect.stringContaining("capabilityKey === HELIX_ASK_LIVE_SYNTHETIC_DATA_REFLECTION_CAPABILITY"));
    expect(routeSource).toEqual(expect.stringContaining('capabilityKey === "helix_ask.reflect_context_attachments"'));
    expect(routeSource).toEqual(expect.stringContaining('capabilityKey === "helix_ask.reflect_ideology_context"'));
    expect(routeSource).toEqual(expect.stringContaining('capabilityKey === "helix_ask.bridge_theory_ideology_context"'));
    expect(routeSource).toEqual(expect.stringContaining('capabilityKey === "helix_ask.build_civilization_scenario_frame"'));
    expect(routeSource).toEqual(expect.stringContaining('capabilityKey === "helix_ask.reflect_civilization_bounds"'));
    expect(routeSource).toEqual(expect.stringContaining('errors.push("missing_required_arg:prompt")'));
    expect(routeSource).toEqual(expect.stringContaining('errors.push("missing_required_arg:text")'));
  });

  it("keeps runtime artifact matching aligned with explicit capability observations", () => {
    const routeSource = readRepoSource("server/routes/agi.plan.ts");
    const artifactQueryIndexSource = readRepoSource("server/services/helix-ask/artifact-query-index.ts");
    expect(routeSource).toEqual(expect.stringContaining("const helixArtifactKindMatchesRuntimeCapability"));
    expect(routeSource).toEqual(expect.stringContaining('requiredAction === "live_env.check_live_source_mail"'));
    expect(routeSource).toEqual(expect.stringContaining('requiredAction === "live_env.read_live_source_mail"'));
    expect(routeSource).toEqual(expect.stringContaining("rawMailReadActionSatisfied"));
    const postToolBridgeSource = readRepoSource("server/services/helix-ask/post-tool-authority-bridge.ts");
    expect(postToolBridgeSource).toEqual(expect.stringContaining("check_live_source_mail"));
    expect(postToolBridgeSource).toEqual(expect.stringContaining("read_live_source_mail"));
    expect(postToolBridgeSource).toEqual(expect.stringContaining("stage_play_live_source_mail_read_result"));
    expect(postToolBridgeSource).toEqual(expect.stringContaining('| "capability_catalog"'));
    expect(postToolBridgeSource).toEqual(expect.stringContaining('| "workspace_directory"'));
    expect(postToolBridgeSource).toEqual(expect.stringContaining('| "workspace_diagnostic"'));
    expect(postToolBridgeSource).toEqual(expect.stringContaining('| "theory_locator"'));
    expect(postToolBridgeSource).toEqual(expect.stringContaining('| "context_reflection"'));
    expect(postToolBridgeSource).toEqual(expect.stringContaining('| "moral_graph_reflection"'));
    expect(postToolBridgeSource).toEqual(expect.stringContaining('| "civilization_bounds"'));
    expect(postToolBridgeSource).toEqual(expect.stringContaining('| "visual_capture"'));
    expect(postToolBridgeSource).toEqual(expect.stringContaining('| "live_environment"'));
    expect(postToolBridgeSource).toEqual(expect.stringContaining("workspace_directory_resolution"));
    expect(postToolBridgeSource).toEqual(expect.stringContaining("workspace_os_status_observation"));
    expect(postToolBridgeSource).toEqual(expect.stringContaining("capability_registry"));
    expect(artifactQueryIndexSource).toEqual(expect.stringContaining("helix_ask_reflect_workstation_tool_alignment"));
    expect(artifactQueryIndexSource).toEqual(expect.stringContaining('return "helix_ask.reflect_workstation_tool_alignment"'));
    expect(artifactQueryIndexSource).toEqual(expect.stringContaining("selectedCapabilityIsCatalog"));
    expect(artifactQueryIndexSource).toEqual(expect.stringContaining("workstation_tool_alignment|toolchain_matrix|tool_regression_matrix"));
    expect(artifactQueryIndexSource).toEqual(expect.stringContaining('return "workspace_os.status"'));
    expect(artifactQueryIndexSource).toEqual(expect.stringContaining('return "docs-viewer.open"'));
    expect(artifactQueryIndexSource).toEqual(expect.stringContaining('return "scholarly-research.lookup_papers"'));
    expect(artifactQueryIndexSource).toEqual(expect.stringContaining('return "scholarly-research.fetch_full_text"'));
    expect(artifactQueryIndexSource).toEqual(expect.stringContaining('return "helix_ask.reflect_theory_context"'));
    expect(artifactQueryIndexSource).toEqual(expect.stringContaining('return "helix.theory.frontierVectorFieldTrace"'));
    expect(artifactQueryIndexSource).toEqual(expect.stringContaining('return "helix_ask.reflect_live_synthetic_data"'));
    expect(artifactQueryIndexSource).toEqual(expect.stringContaining('return "helix_ask.reflect_context_attachments"'));
    expect(artifactQueryIndexSource).toEqual(expect.stringContaining('return "helix_ask.reflect_ideology_context"'));
    expect(artifactQueryIndexSource).toEqual(expect.stringContaining('return "helix_ask.bridge_theory_ideology_context"'));
    expect(artifactQueryIndexSource).toEqual(expect.stringContaining('return "helix_ask.build_civilization_scenario_frame"'));
    expect(artifactQueryIndexSource).toEqual(expect.stringContaining('return "helix_ask.reflect_civilization_bounds"'));
    expect(artifactQueryIndexSource).toEqual(expect.stringContaining("scholarly_research_lookup_papers"));
    expect(artifactQueryIndexSource).toEqual(expect.stringContaining("helix_ask_reflect_civilization_bounds"));
    expect(artifactQueryIndexSource).toEqual(
      expect.stringContaining("if (/live_env[-_.:]process_live_source_mail/.test(haystack))"),
    );
    expect(artifactQueryIndexSource).not.toEqual(
      expect.stringContaining("process_live_source_mail|stage_play_live_source_mail_read_result"),
    );
    expect(postToolBridgeSource).toEqual(expect.stringContaining("helix_theory_context_reflection_tool_receipt"));
    expect(postToolBridgeSource).toEqual(expect.stringContaining("helix_moral_graph_reflection_tool_result"));
    expect(postToolBridgeSource).toEqual(expect.stringContaining("civilization_bounds_roadmap"));
    expect(postToolBridgeSource).toEqual(expect.stringContaining("visual_capture_coverage"));
    expect(routeSource).toEqual(expect.stringContaining('capability === "repo-code.search_concept"'));
    expect(routeSource).toEqual(expect.stringContaining('"repo_evidence_relevance_gate"'));
    expect(routeSource).toEqual(expect.stringContaining("capability === HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY"));
    expect(routeSource).toEqual(expect.stringContaining('"scholarly_full_text_observation"'));
    expect(routeSource).toEqual(expect.stringContaining("capability === HELIX_THEORY_FRONTIER_VECTOR_FIELD_TRACE_CAPABILITY"));
    expect(routeSource).toEqual(expect.stringContaining('"theory_frontier_vector_field"'));
    expect(routeSource).toEqual(expect.stringContaining('capability === "helix_ask.bridge_theory_ideology_context"'));
    expect(routeSource).toEqual(expect.stringContaining('"helix_theory_ideology_bridge_tool_result"'));
    expect(routeSource).toEqual(expect.stringContaining('capability === "helix_ask.reflect_civilization_bounds"'));
    expect(routeSource).toEqual(expect.stringContaining('"civilization_bounds_roadmap/v1"'));
    expect(routeSource).toEqual(expect.stringContaining('capability === "image_lens.inspect"'));
    expect(routeSource).toEqual(expect.stringContaining('"visual_capture_coverage"'));
    expect(routeSource).toEqual(expect.stringContaining("capability === HELIX_ASK_CAPABILITY_CATALOG_CAPABILITY"));
    expect(routeSource).toEqual(expect.stringContaining('"capability_registry"'));
  });

  it("keeps compound subgoal observation inference aligned with explicit capability observations", () => {
    const executionSource = readRepoSource("server/services/helix-ask/capability-itinerary-execution.ts");
    const evidenceReentryGateSource = readRepoSource("server/services/helix-ask/evidence-reentry-gate.ts");
    expect(executionSource).toEqual(expect.stringContaining("const observationKindBelongsToCapability"));
    expect(executionSource).toEqual(expect.stringContaining('capability === "docs-viewer.open"'));
    expect(executionSource).toEqual(expect.stringContaining('capability === "docs-viewer.summarize_doc"'));
    expect(executionSource).toEqual(expect.stringContaining('capability === "docs-viewer.doc_equation_context"'));
    expect(executionSource).toEqual(expect.stringContaining('capability === "workspace-directory.resolve"'));
    expect(executionSource).toEqual(expect.stringContaining('capability === "helix_ask.reflect_workstation_tool_alignment"'));
    expect(executionSource).toEqual(expect.stringContaining('capability === "internet_search.web_research"'));
    expect(executionSource).toEqual(expect.stringContaining("internet-search.search_web"));
    expect(executionSource).toEqual(expect.stringContaining('capability === "scholarly-research.lookup_papers"'));
    expect(executionSource).toEqual(expect.stringContaining("scholarly_research_observation"));
    expect(executionSource).toEqual(expect.stringContaining('capability === "scholarly-research.fetch_full_text"'));
    expect(executionSource).toEqual(expect.stringContaining("scholarly_full_text_observation"));
    expect(executionSource).toEqual(expect.stringContaining('capability === "helix_ask.reflect_theory_context"'));
    expect(executionSource).toEqual(expect.stringContaining("theory_context_reflection"));
    expect(executionSource).toEqual(expect.stringContaining('capability === "helix_ask.reflect_live_synthetic_data"'));
    expect(executionSource).toEqual(expect.stringContaining("bounded_context_reference"));
    expect(executionSource).toEqual(expect.stringContaining('capability === "helix_ask.bridge_theory_ideology_context"'));
    expect(executionSource).toEqual(expect.stringContaining("theory_ideology_bridge"));
    expect(executionSource).toEqual(expect.stringContaining('capability === "helix_ask.reflect_civilization_bounds"'));
    expect(executionSource).toEqual(expect.stringContaining("civilization_bounds_roadmap"));
    expect(executionSource).toEqual(expect.stringContaining('capability.startsWith("live_env.")'));
    expect(executionSource).toEqual(expect.stringContaining('capability === "workstation-notes.append_to_note"'));
    expect(executionSource).toEqual(expect.stringContaining("  return false;\n};\n\nconst calculatorExpressionFromRecord"));
    expect(executionSource).toEqual(expect.stringContaining('family === "context_reflection"'));
    expect(evidenceReentryGateSource).toEqual(expect.stringContaining("const capabilityItineraryEvidencePatterns"));
    for (const family of [
      "calculator",
      "docs_viewer",
      "repo_code",
      "workspace_directory",
      "workspace_diagnostic",
      "workstation",
      "capability_catalog",
      "internet_search",
      "scholarly_research",
      "theory_locator",
      "context_reflection",
      "moral_graph_reflection",
      "civilization_bounds",
      "visual_capture",
      "situation_run",
      "live_environment",
      "live_source_mail",
      "live_pipeline",
      "live_source_decision",
      "process_graph",
      "voice_delivery",
      "notes",
      "workstation_action",
    ]) {
      expect(evidenceReentryGateSource, `evidence_reentry_itinerary_family:${family}`).toEqual(
        expect.stringContaining(`family: "${family}"`),
      );
    }
    expect(evidenceReentryGateSource).toEqual(
      expect.stringContaining("capabilityItineraryEntryMatchesObservedFamily(entry, requiredObserved)"),
    );
  });

  it("keeps top-level tool rail audit aligned with compound subgoal failures", () => {
    const indexSource = readRepoSource("server/services/helix-ask/artifact-query-index.ts");
    expect(indexSource).toEqual(expect.stringContaining("compoundSubgoalRailStatuses?: RecordLike[]"));
    expect(indexSource).toEqual(expect.stringContaining("const compoundSubgoalHasSatisfiedObservation"));
    expect(indexSource).toEqual(expect.stringContaining("const firstIncompleteCompoundSubgoal"));
    expect(indexSource).toEqual(expect.stringContaining("!compoundSubgoalHasSatisfiedObservation(entry)"));
    expect(indexSource).toEqual(expect.stringContaining("const compoundRailFailureCode"));
    expect(indexSource).toEqual(expect.stringContaining("compoundSubgoalRailStatuses,"));
    expect(indexSource).toEqual(expect.stringContaining("first_incomplete_compound_subgoal_id"));
    expect(indexSource).toEqual(expect.stringContaining("compound_first_broken_rail"));
    expect(indexSource).toEqual(expect.stringContaining("compound_rail_failure_code"));
    expect(indexSource).toEqual(expect.stringContaining("compound_repair_target"));
    expect(indexSource).toEqual(expect.stringContaining("compound_incomplete_subgoal_did_tool_run"));
    expect(indexSource).toEqual(expect.stringContaining('compoundRailFailureCodeRaw?.startsWith("missing_required_arg:")'));
    expect(indexSource).toEqual(expect.stringContaining("const firstIncompleteCompoundExecutedCapability"));
    expect(indexSource).toEqual(expect.stringContaining("matrixStatusForCompoundEntries"));
    expect(indexSource).toEqual(expect.stringContaining("const buildCodexParityAgentSpineRailTable"));
    expect(indexSource).toEqual(expect.stringContaining("compound_subgoal_count:\n      readNumber(input.audit.compound_subgoal_count)"));
    expect(indexSource).toEqual(expect.stringContaining("first_incomplete_compound_requested_capability:\n      readNullableString(input.audit.first_incomplete_compound_requested_capability)"));
    expect(indexSource).toEqual(expect.stringContaining("first_incomplete_compound_executed_capability:\n      readNullableString(input.audit.first_incomplete_compound_executed_capability)"));
    expect(indexSource).toEqual(expect.stringContaining("compound_incomplete_subgoal_did_tool_run:\n      typeof input.triage.compound_incomplete_subgoal_did_tool_run"));
  });

  it("keeps compound live probe aligned with top-level rail-table compound mirrors", () => {
    const probeSource = readRepoSource("scripts/helix-ask-compound-capability-live-probe.ts");
    const probeTestSource = readRepoSource("server/__tests__/helix.ask.compound-capability-live-probe.test.ts");
    expect(probeSource).toEqual(expect.stringContaining("const codexParityRailTableFor"));
    expect(probeSource).toEqual(expect.stringContaining("codex_parity_agent_spine_rail_table"));
    expect(probeSource).toEqual(expect.stringContaining("backend_visible_terminal_kind"));
    expect(probeSource).toEqual(expect.stringContaining("backendVisibleTerminalKindFor"));
    expect(probeSource).toEqual(expect.stringContaining("backend_visible_terminal_kind_missing"));
    expect(probeSource).toEqual(expect.stringContaining("backend_terminal_projection_mismatch"));
    expect(probeSource).toEqual(expect.stringContaining("top_level_compound_subgoal_count"));
    expect(probeSource).toEqual(expect.stringContaining("top_level_first_incomplete_compound_subgoal_id"));
    expect(probeSource).toEqual(expect.stringContaining("top_level_first_incomplete_compound_requested_capability"));
    expect(probeSource).toEqual(expect.stringContaining("top_level_first_incomplete_compound_executed_capability"));
    expect(probeSource).toEqual(expect.stringContaining("top_level_compound_rail_failure_code"));
    expect(probeSource).toEqual(expect.stringContaining("top_level_incomplete_subgoal_did_tool_run_mismatch"));
    expect(probeSource).toEqual(expect.stringContaining("unexpected_top_level_first_incomplete_subgoal_id"));
    expect(probeSource).toEqual(expect.stringContaining("NON_MATH_CALCULATOR_ARG_PATTERN"));
    expect(probeSource).toEqual(expect.stringContaining("helix_ask"));
    expect(probeSource).toEqual(expect.stringContaining("internet[_-]?search"));
    expect(probeSource).toEqual(expect.stringContaining("scholarly[-_]?research"));
    expect(probeTestSource).toEqual(expect.stringContaining("const deterministicDebugFixtureByScenarioId"));
    expect(probeTestSource).toEqual(
      expect.stringContaining("COMPOUND_CAPABILITY_LIVE_SCENARIOS.map((scenario) => scenario.id).sort()"),
    );
    expect(probeTestSource).toEqual(expect.stringContaining("liveSourceMailReadProcessDecisionDebug"));
    expect(probeTestSource).toEqual(expect.stringContaining("liveSourceMailCheckThenRawReadDebug"));
    expect(probeTestSource).toEqual(expect.stringContaining("liveSourceDecisionThenVoiceCalloutDebug"));
    expect(probeTestSource).toEqual(expect.stringContaining("liveSourceQualityGoalContextStateDebug"));
    expect(probeTestSource).toEqual(expect.stringContaining("repoReflectionCalculatorDebug"));
    expect(probeTestSource).toEqual(expect.stringContaining("docsReflectionCalculatorDebug"));
    expect(probeTestSource).toEqual(expect.stringContaining('case "internet-search.search_web"'));
    expect(probeTestSource).toEqual(expect.stringContaining('case "situation-room.describe_visual_capture"'));
    expect(probeTestSource).not.toEqual(expect.stringContaining('optional_args: ["document_path", "doc"]'));
    const fixtureContractCases = new Set(
      [...probeTestSource.matchAll(/case "([^"]+)"/g)]
        .map((match) => match[1])
        .filter(Boolean),
    );
    const liveProbeRequestedAndRuntimeCapabilities = new Set(
      COMPOUND_CAPABILITY_LIVE_SCENARIOS.flatMap((scenario) => [
        ...flattenExpectedCapabilities(scenario.expectedRequested),
        ...flattenExpectedCapabilities(scenario.expectedRuntime),
      ]),
    );
    for (const capability of liveProbeRequestedAndRuntimeCapabilities) {
      expect(fixtureContractCases.has(capability), `fixture_contract_terms:${capability}`).toBe(true);
    }
    for (const scenario of COMPOUND_CAPABILITY_LIVE_SCENARIOS) {
      expect(probeTestSource, `deterministic_fixture:${scenario.id}`).toEqual(
        expect.stringContaining(`${scenario.id}:`),
      );
    }
  });

  it("keeps UI/API debug parity comparisons aligned with compound rail-table mirrors", () => {
    const harnessSource = readRepoSource("scripts/helix-ask-ui-debug-parity-harness.ts");
    const apiProbeSource = readRepoSource("server/services/helix-ask/api-parity-probe.ts");
    const toolChainProbeSource = readRepoSource("scripts/helix-ask-tool-chain-matrix-probe.ts");
    const liveSpineSmokeSource = readRepoSource("scripts/helix-ask-live-spine-smoke.ts");
    const liveProbeSource = readRepoSource("scripts/helix-ask-compound-capability-live-probe.ts");
    const contractSource = readRepoSource("server/services/helix-ask/codex-parity-agent-spine-contract.ts");
    const visibleTerminalResolverSource = readRepoSource("client/src/lib/helix/resolveHelixVisibleTerminal.ts");
    const visibleTerminalResolverTestSource = readRepoSource("client/src/lib/helix/resolveHelixVisibleTerminal.spec.ts");
    const artifactQueryIndexSource = readRepoSource("server/services/helix-ask/artifact-query-index.ts");
    const explicitCapabilityContractSource = readRepoSource("server/services/helix-ask/explicit-capability-contract.ts");
    const toolFamilyContractSource = readRepoSource("server/services/helix-ask/tool-family-contract.ts");
    const compoundCapabilityContractSource = readRepoSource("server/services/helix-ask/compound-capability-contract.ts");
    const sharedTerminalAuthoritySource = readRepoSource("shared/helix-terminal-authority.ts");
    const harnessTestSource = readRepoSource("server/__tests__/helix.ask.ui-debug-parity-harness.test.ts");
    const apiProbeTestSource = readRepoSource("server/__tests__/helix.ask.api-parity-rail-envelope.test.ts");
    const liveSpineSmokeTestSource = readRepoSource("server/__tests__/helix.ask.live-spine-smoke-dry-run.test.ts");
    const toolChainMatrixTestSource = readRepoSource("server/__tests__/helix.ask.tool-chain-matrix-selection.test.ts");
    expect(contractSource).toEqual(expect.stringContaining("CODEX_PARITY_AGENT_SPINE_COMPOUND_STRING_OR_NULL_FIELDS"));
    expect(harnessSource).toEqual(expect.stringContaining("CODEX_PARITY_AGENT_SPINE_COMPOUND_STRING_OR_NULL_FIELDS"));
    expect(apiProbeSource).toEqual(expect.stringContaining("CODEX_PARITY_AGENT_SPINE_COMPOUND_STRING_OR_NULL_FIELDS"));
    expect(toolChainProbeSource).toEqual(expect.stringContaining("CODEX_PARITY_AGENT_SPINE_COMPOUND_STRING_OR_NULL_FIELDS"));
    expect(liveSpineSmokeSource).toEqual(expect.stringContaining("CODEX_PARITY_AGENT_SPINE_COMPOUND_STRING_OR_NULL_FIELDS"));
    for (const field of [
      "compound_subgoal_count",
      "first_incomplete_compound_subgoal_id",
      "first_incomplete_compound_requested_capability",
      "first_incomplete_compound_runtime_capability",
      "first_incomplete_compound_selected_capability",
      "first_incomplete_compound_executed_capability",
      "compound_first_broken_rail",
      "compound_rail_failure_code",
      "compound_repair_target",
      "compound_incomplete_subgoal_did_tool_run",
    ]) {
      expect(harnessSource, `ui_api_rail_field:${field}`).toEqual(expect.stringContaining(`"${field}"`));
      expect(apiProbeSource, `api_probe_rail_field:${field}`).toEqual(expect.stringContaining(`"${field}"`));
      expect(toolChainProbeSource, `tool_chain_probe_rail_field:${field}`).toEqual(expect.stringContaining(`"${field}"`));
      expect(liveSpineSmokeSource, `live_spine_smoke_rail_field:${field}`).toEqual(expect.stringContaining(`"${field}"`));
      if (field !== "compound_subgoal_count" && field !== "compound_incomplete_subgoal_did_tool_run") {
        expect(contractSource, `rail_contract_string_field:${field}`).toEqual(expect.stringContaining(`"${field}"`));
      }
    }
    expect(harnessSource).toEqual(expect.stringContaining("rail_incomplete_compound_first_incomplete_subgoal_missing"));
    expect(apiProbeSource).toEqual(expect.stringContaining("rail_incomplete_compound_first_incomplete_subgoal_missing"));
    expect(toolChainProbeSource).toEqual(expect.stringContaining("rail_compound_incomplete_missing"));
    expect(liveSpineSmokeSource).toEqual(expect.stringContaining("compound_incomplete_missing"));
    expect(harnessTestSource).toEqual(expect.stringContaining("flags stale UI/API compound first-incomplete subgoal rail mirrors"));
    expect(harnessTestSource).toEqual(expect.stringContaining("rejects incomplete compound rails without first-incomplete subgoal mirrors"));
    expect(apiProbeTestSource).toEqual(expect.stringContaining("rejects incomplete compound rails without first-incomplete subgoal mirrors"));
    expect(apiProbeSource).toEqual(expect.stringContaining("HelixApiParityCompoundSubgoalRailSummary"));
    expect(apiProbeSource).toEqual(expect.stringContaining("readCompoundSubgoalRailStatuses"));
    expect(apiProbeSource).toEqual(expect.stringContaining("compound_subgoal_rails"));
    expect(apiProbeSource).toEqual(expect.stringContaining("rail_compound_subgoal_rail_statuses_dropped"));
    expect(apiProbeSource).toEqual(expect.stringContaining("satisfied_observation_ref_missing"));
    expect(apiProbeSource).toEqual(expect.stringContaining("complete_observation_ref_missing"));
    expect(liveProbeSource).toEqual(expect.stringContaining("subgoalHasSatisfiedObservation"));
    expect(liveProbeSource).toEqual(expect.stringContaining("satisfied_observation_ref_missing"));
    expect(liveProbeSource).toEqual(expect.stringContaining("rail_complete_observation_ref_missing"));
    expect(apiProbeSource).toEqual(expect.stringContaining("_order_invalid"));
    expect(apiProbeSource).toEqual(expect.stringContaining("_args_field_missing"));
    expect(apiProbeSource).toEqual(expect.stringContaining("_first_broken_rail_missing"));
    expect(apiProbeSource).toEqual(expect.stringContaining("_rail_failure_code_missing"));
    expect(apiProbeSource).toEqual(expect.stringContaining("_repair_target_missing"));
    expect(harnessSource).toEqual(expect.stringContaining("collectUiDebugCompoundSubgoalRailStatuses"));
    expect(harnessSource).toEqual(expect.stringContaining("compoundSubgoalRailComparisonFields"));
    expect(harnessSource).toEqual(expect.stringContaining("compoundSubgoalRailProofViolations"));
    expect(harnessSource).toEqual(expect.stringContaining('"order"'));
    expect(harnessSource).toEqual(expect.stringContaining('"input_bindings"'));
    expect(harnessSource).toEqual(expect.stringContaining('"bound_input_refs"'));
    expect(harnessSource).toEqual(expect.stringContaining('"unresolved_input_bindings"'));
    expect(harnessSource).toEqual(expect.stringContaining('"args_source"'));
    expect(harnessSource).toEqual(expect.stringContaining('"planned_args"'));
    expect(harnessSource).toEqual(expect.stringContaining('"selected_args"'));
    expect(harnessSource).toEqual(expect.stringContaining('"required_args"'));
    expect(harnessSource).toEqual(expect.stringContaining('"optional_args"'));
    expect(harnessSource).toEqual(expect.stringContaining('"observation_provenance"'));
    expect(harnessSource).toEqual(expect.stringContaining('"support_refs"'));
    expect(harnessSource).toEqual(expect.stringContaining('"required_observation_kinds"'));
    expect(harnessSource).toEqual(expect.stringContaining('"required_terminal_kind"'));
    expect(harnessSource).toEqual(expect.stringContaining('"terminal_contribution_kind"'));
    expect(harnessSource).toEqual(expect.stringContaining('"contribution_role"'));
    expect(harnessSource).toEqual(expect.stringContaining('"allowed_substitutions"'));
    expect(harnessSource).toEqual(expect.stringContaining('"forbidden_nearby_capabilities"'));
    expect(harnessSource).toEqual(expect.stringContaining("ui_api_compound_subgoal_rails_mismatch"));
    expect(harnessSource).toEqual(expect.stringContaining("expectedCompoundSubgoalCount"));
    expect(harnessSource).toEqual(expect.stringContaining("ui_compound_subgoal_rails_missing"));
    expect(harnessSource).toEqual(expect.stringContaining("api_compound_subgoal_rails_missing"));
    expect(apiProbeTestSource).toEqual(expect.stringContaining("summarizes ordered compound subgoal rails for API parity diagnostics"));
    expect(apiProbeTestSource).toEqual(expect.stringContaining("rejects complete compound subgoal rails without observation proof"));
    expect(apiProbeTestSource).toEqual(expect.stringContaining("rejects compound rails when the ordered subgoal rail statuses are dropped"));
    expect(apiProbeTestSource).toEqual(expect.stringContaining("rejects malformed compound subgoal rails without ordered args or fail-closed rail fields"));
    expect(harnessTestSource).toEqual(expect.stringContaining("flags UI/API ordered compound subgoal rail divergence even when top-level mirrors match"));
    expect(harnessTestSource).toEqual(expect.stringContaining("flags UI/API compound subgoal contract and provenance divergence"));
    expect(harnessTestSource).toEqual(expect.stringContaining("flags missing compound subgoal rail mirrors when top-level rails declare a compound turn"));
    expect(harnessTestSource).toEqual(expect.stringContaining("flags shared UI/API complete compound subgoal rails without observation proof"));
    expect(harnessTestSource).toEqual(expect.stringContaining("flags UI/API compound subgoal order divergence"));
    expect(harnessTestSource).toEqual(expect.stringContaining("flags UI/API compound subgoal binding divergence"));
    expect(harnessTestSource).toEqual(expect.stringContaining("flags UI/API compound subgoal argument metadata divergence"));
    expect(apiProbeTestSource).toEqual(expect.stringContaining("rejects rails with visible projection kind but no projection proof source"));
    expect(apiProbeTestSource).toEqual(expect.stringContaining("rejects rails with visible projection kind but unproven projection source"));
    expect(harnessTestSource).toEqual(expect.stringContaining("ui_api_rail_first_incomplete_compound_subgoal_id_mismatch"));
    expect(harnessTestSource).toEqual(expect.stringContaining("ui_api_rail_compound_rail_failure_code_mismatch"));
    expect(harnessTestSource).toEqual(expect.stringContaining("rejects visible rail projections without a projection proof source"));
    expect(harnessTestSource).toEqual(expect.stringContaining("rejects visible rail projections whose projection source is not proven"));
    expect(harnessTestSource).toEqual(expect.stringContaining("rail_visible_projection_source_missing"));
    expect(harnessTestSource).toEqual(expect.stringContaining("rail_visible_projection_not_proven"));
    expect(toolChainProbeSource).toEqual(expect.stringContaining("visible_projection_source"));
    expect(toolChainProbeSource).toEqual(expect.stringContaining("visible_projection_proven"));
    expect(toolChainProbeSource).toEqual(expect.stringContaining("rail_visible_projection_source_missing"));
    expect(toolChainProbeSource).toEqual(expect.stringContaining("rail_visible_projection_not_proven"));
    expect(toolChainMatrixTestSource).toEqual(expect.stringContaining("rejects tool-chain rail tables that project a visible terminal without a projection source"));
    expect(toolChainMatrixTestSource).toEqual(expect.stringContaining("rejects tool-chain rail tables that project a visible terminal from an unproven source"));
    expect(toolChainMatrixTestSource).toEqual(expect.stringContaining("rail_visible_projection_source_missing"));
    expect(toolChainMatrixTestSource).toEqual(expect.stringContaining("rail_visible_projection_not_proven"));
    expect(artifactQueryIndexSource).toEqual(expect.stringContaining('"payload.terminal_artifact_kind+visible_answer_text"'));
    expect(artifactQueryIndexSource).toEqual(expect.stringContaining("proven: Boolean(payloadVisibleText)"));
    expect(artifactQueryIndexSource).toEqual(expect.stringContaining("visibleTerminalProjection.proven"));
    const unprovenPayloadProjectionSource =
      'visible_projection_source: "' + 'payload.terminal_artifact_kind"';
    expect(apiProbeTestSource).not.toEqual(expect.stringContaining(unprovenPayloadProjectionSource));
    expect(liveSpineSmokeTestSource).toEqual(expect.stringContaining("fails fixture classification when visible projection source is missing"));
    expect(liveSpineSmokeTestSource).toEqual(expect.stringContaining("fails fixture classification when visible projection source is not proven"));
    expect(liveSpineSmokeTestSource).toEqual(expect.stringContaining("visible_projection_source_missing"));
    expect(liveSpineSmokeTestSource).toEqual(expect.stringContaining("visible_projection_not_proven"));
    expect(visibleTerminalResolverSource).toEqual(expect.stringContaining("terminal_authority_single_writer"));
    expect(visibleTerminalResolverSource).toEqual(expect.stringContaining("singleWriter?.selected_terminal_artifact_kind"));
    expect(visibleTerminalResolverSource).toEqual(expect.stringContaining("sourceCapabilityTurn"));
    expect(visibleTerminalResolverSource).toEqual(expect.stringContaining("terminal_authority_missing"));
    for (const terminalLabel of [
      "model_synthesized_answer",
      "capability_help_summary",
      "workspace_status_answer",
      "workspace_directory_resolution",
      "doc_evidence_synthesis_answer",
      "doc_equation_context",
      "theory_context_reflection_answer",
    ]) {
      expect(visibleTerminalResolverSource, `visible_terminal_label:${terminalLabel}`).toEqual(
        expect.stringContaining(terminalLabel),
      );
      expect(visibleTerminalResolverTestSource, `visible_terminal_label_test:${terminalLabel}`).toEqual(
        expect.stringContaining(terminalLabel),
      );
    }
    const declaredTerminalKinds = new Set([
      ...extractDeclaredTerminalKinds(explicitCapabilityContractSource),
      ...extractDeclaredTerminalKinds(toolFamilyContractSource),
      ...extractDeclaredTerminalKinds(compoundCapabilityContractSource),
    ]);
    const visibleTerminalLabelKinds = extractVisibleTerminalLabelKinds(visibleTerminalResolverSource);
    const missingVisibleTerminalLabels = [...declaredTerminalKinds]
      .filter((terminalKind) => !visibleTerminalLabelKinds.has(terminalKind))
      .sort((left, right) => left.localeCompare(right));
    expect(missingVisibleTerminalLabels).toEqual([]);
    expect(visibleTerminalResolverTestSource).toEqual(expect.stringContaining("prefers debug single-writer authority over a stale model-draft shell"));
    expect(visibleTerminalResolverTestSource).toEqual(expect.stringContaining("uses single-writer terminal metadata over stale envelope and API labels"));
    expect(visibleTerminalResolverTestSource).toEqual(expect.stringContaining("terminal_authority_missing"));
    for (const terminalKind of [
      "workstation_tool_evaluation",
      "calculator_stream_result",
      "calculation_trace",
      "tool_evaluation",
      "workspace_directory_resolution",
      "workspace_status_answer",
      "theory_context_reflection_answer",
      "doc_search_results",
      "doc_equation_context",
      "docs_viewer_receipt",
      "stage_play_live_source_mail_decision",
      "live_source_interim_voice_callout_receipt",
      "narrator_bind_stream_receipt",
      "narrator_say_receipt",
      "voice_receipt",
    ]) {
      expect(sharedTerminalAuthoritySource, `shared_terminal_authority_kind:${terminalKind}`).toEqual(
        expect.stringContaining(`| "${terminalKind}"`),
      );
    }
  });

  it("has explicit capability contracts for every objective family", () => {
    for (const entry of objectiveFamilyCoverage) {
      for (const family of entry.contractFamilies) {
        expect(contractsByFamily.has(family), `${entry.label}:${family}`).toBe(true);
      }
      for (const capability of entry.representativeCapabilities) {
        expect(contractCapabilities.has(capability), `${entry.label}:${capability}`).toBe(true);
      }
    }
  });

  it("keeps every explicit capability contract shaped for the full parity rail", () => {
    const genericReceiptTerminals = new Set([
      "tool_receipt",
      "calculator_receipt",
      "docs_viewer_receipt",
      "live_environment_tool_observation",
    ]);

    for (const contract of explicitCapabilityContractsForTests) {
      expect(contract.schema, `${contract.capability}:schema`)
        .toBe("helix.explicit_capability_contract.v1");
      expect(contract.capability, `${contract.capability}:capability`).toBeTruthy();
      expect(contract.capability_family, `${contract.capability}:capability_family`).toBeTruthy();
      expect(contract.plan_family, `${contract.capability}:plan_family`).toBeTruthy();
      expect(contract.source_target, `${contract.capability}:source_target`).toBeTruthy();
      expect(contract.admission_families.length, `${contract.capability}:admission_families`)
        .toBeGreaterThan(0);
      expect(contract.required_observation_kinds.length, `${contract.capability}:required_observation_kinds`)
        .toBeGreaterThan(0);
      expect(contract.required_terminal_kind, `${contract.capability}:required_terminal_kind`).toBeTruthy();
      expect(Array.isArray(contract.required_args), `${contract.capability}:required_args`).toBe(true);
      expect(Array.isArray(contract.optional_args), `${contract.capability}:optional_args`).toBe(true);
      expect(Array.isArray(contract.allowed_substitutions), `${contract.capability}:allowed_substitutions`)
        .toBe(true);
      expect(
        Array.isArray(contract.forbidden_nearby_capabilities),
        `${contract.capability}:forbidden_nearby_capabilities`,
      ).toBe(true);
      expect(
        contract.forbidden_nearby_capabilities.length,
        `${contract.capability}:forbidden_nearby_capabilities`,
      ).toBeGreaterThan(0);
      expect(
        contract.forbidden_nearby_capabilities,
        `${contract.capability}:model_direct_answer_forbidden`,
      ).toContain("model.direct_answer");
      expect(
        genericReceiptTerminals.has(contract.required_terminal_kind),
        `${contract.capability}:generic_receipt_terminal_forbidden:${contract.required_terminal_kind}`,
      ).toBe(false);
    }
  });

  it("keeps docs open as an explicit route-contract receipt exception, not compound fallback authority", () => {
    const openContract = explicitCapabilityContractForCapability("docs-viewer.open");
    expect(openContract?.required_terminal_kind).toBe("doc_open_receipt");
    expect(openContract?.required_observation_kinds).toEqual(
      expect.arrayContaining(["doc_open_receipt", "docs_viewer_receipt"]),
    );

    expect(forbiddenCompoundScenarioTerminalKinds.has("doc_open_receipt")).toBe(true);
  });

  it("resolves every objective family through the shared tool-family contract registry", () => {
    for (const entry of objectiveFamilyCoverage) {
      for (const family of entry.contractFamilies) {
        const familyContract = resolveToolFamilyContract({ toolFamily: family });
        expect(familyContract?.toolFamily, `${entry.label}:${family}:family`).toBe(family);
        expect(familyContract?.requiredObservationKinds.length, `${entry.label}:${family}:observations`)
          .toBeGreaterThan(0);
      }

      for (const capability of entry.representativeCapabilities) {
        const capabilityContract = resolveToolFamilyContract({ toolName: capability });
        expect(capabilityContract, `${entry.label}:${capability}:tool`).toBeTruthy();
        expect(entry.contractFamilies, `${entry.label}:${capability}:family`).toContain(capabilityContract?.toolFamily);
      }
    }
  });

  it.each([
    ["account_session.set_interface_language", "workstation"],
    ["repo.search", "repo_code"],
    ["docs.search", "docs_viewer"],
    ["theory-badge-graph.reflect_discussion_context", "theory_locator"],
    ["text_to_speech.speak_text", "voice_delivery"],
  ] as const)("resolves gateway alias %s to authority family %s", (capability, family) => {
    const resolved = resolveToolFamilyContract({ toolName: capability });
    expect(resolved?.toolFamily).toBe(family);
    expect(resolved?.requiredReentry).toBe(true);
    expect(resolved?.requiresGoalSatisfaction).toBe(true);
  });

  it("resolves audited explicit capabilities to their explicit family before broad alias inference", () => {
    for (const capability of auditedExplicitCapabilities) {
      const explicit = explicitCapabilityContractForCapability(capability);
      const resolved = resolveToolFamilyContract({ toolName: capability });
      expect(explicit, `${capability}:explicit_contract`).toBeTruthy();
      expect(resolved?.toolFamily, `${capability}:resolved_family`).toBe(explicit?.capability_family);

      if (explicit?.runtime_capability && explicit.runtime_capability !== explicit.capability) {
        const runtimeResolved = resolveToolFamilyContract({ toolName: explicit.runtime_capability });
        expect(runtimeResolved?.toolFamily, `${capability}:runtime:${explicit.runtime_capability}:resolved_family`)
          .toBe(explicit.capability_family);
      }
    }
  });

  it("keeps resolved tool-family contracts aligned with explicit observation and terminal requirements", () => {
    for (const explicit of explicitCapabilityContractsForTests) {
      const resolved = resolveToolFamilyContract({ toolName: explicit.capability });
      expect(resolved?.toolFamily, `${explicit.capability}:resolved_family`)
        .toBe(explicit.capability_family);
      expect(resolved?.requiredObservationKinds ?? [], `${explicit.capability}:resolved_observations`)
        .toEqual(expect.arrayContaining(explicit.required_observation_kinds));
      expect(resolved?.allowedTerminalKinds ?? [], `${explicit.capability}:resolved_terminal`)
        .toContain(explicit.required_terminal_kind);

      if (explicit.runtime_capability && explicit.runtime_capability !== explicit.capability) {
        const runtimeResolved = resolveToolFamilyContract({ toolName: explicit.runtime_capability });
        expect(runtimeResolved?.toolFamily, `${explicit.capability}:runtime:${explicit.runtime_capability}:family`)
          .toBe(explicit.capability_family);
        expect(
          runtimeResolved?.requiredObservationKinds ?? [],
          `${explicit.capability}:runtime:${explicit.runtime_capability}:observations`,
        ).toEqual(expect.arrayContaining(explicit.required_observation_kinds));
        expect(
          runtimeResolved?.allowedTerminalKinds ?? [],
          `${explicit.capability}:runtime:${explicit.runtime_capability}:terminal`,
        ).toContain(explicit.required_terminal_kind);
      }
    }
  });

  it("keeps governed live-environment controls resolving to their explicit contract family", () => {
    const routeSource = readRepoSource("server/routes/agi.plan.ts");
    for (const capability of governedLiveEnvironmentCapabilities) {
      const explicit = explicitCapabilityContractForCapability(capability);
      const resolved = resolveToolFamilyContract({ toolName: capability });
      expect(routeSource, `${capability}:model_visible_schema_case`)
        .toEqual(expect.stringContaining(`case "${capability}":`));
      expect(explicit?.capability, `${capability}:explicit_contract`).toBe(capability);
      expect(explicit?.capability_family, `${capability}:explicit_family`).toBe("live_environment");
      expect(resolved?.toolFamily, `${capability}:resolved_family`).toBe("live_environment");
      expect(resolved?.requiredObservationKinds ?? [], `${capability}:resolved_observations`)
        .toEqual(expect.arrayContaining(explicit?.required_observation_kinds ?? []));
      expect(resolved?.allowedTerminalKinds ?? [], `${capability}:resolved_terminal`)
        .toContain(explicit?.required_terminal_kind);

      const compound = buildHelixCompoundCapabilityContract({
        turnId: `ask:tool-family-parity:governed-live-env:${capability}`.replace(/[^A-Za-z0-9:_-]+/g, "_"),
        promptText: `Call ${capability} for Helix Ask parity coverage.`,
      });
      const subgoals = compound?.subgoals ?? [];
      expect(compound?.prompt_shape, `${capability}:compound_shape`).toBe("single_capability");
      expect(subgoals, `${capability}:compound_subgoals`).toHaveLength(1);
      expect(subgoals[0]).toEqual(expect.objectContaining({
        requested_capability: capability,
        runtime_capability: capability,
        required_observation_kinds: explicit?.required_observation_kinds,
        required_terminal_kind: explicit?.required_terminal_kind,
        forbidden_nearby_capabilities: explicit?.forbidden_nearby_capabilities,
        mandatory: true,
        status: "pending",
      }));
    }
  });

  it("keeps specialized live-env decision and voice rails explicit without receipt terminal fallback", () => {
    for (const capability of specializedLiveEnvironmentCapabilities) {
      const explicit = explicitCapabilityContractForCapability(capability);
      const resolved = resolveToolFamilyContract({ toolName: capability });
      expect(explicit?.capability, `${capability}:explicit_contract`).toBe(capability);
      expect(["live_source_decision", "voice_delivery"], `${capability}:explicit_family`)
        .toContain(explicit?.capability_family);
      expect(resolved?.toolFamily, `${capability}:resolved_family`).toBe(explicit?.capability_family);
      expect(explicit?.required_terminal_kind, `${capability}:terminal_kind`).toBe("model_synthesized_answer");
      expect(resolved?.allowedTerminalKinds, `${capability}:resolved_synth_terminal`)
        .toContain("model_synthesized_answer");
      for (const receiptKind of specializedLiveEnvironmentReceiptTerminalKinds) {
        expect(resolved?.allowedTerminalKinds ?? [], `${capability}:receipt_terminal_forbidden:${receiptKind}`)
          .not.toContain(receiptKind);
      }
      expect(explicit?.forbidden_nearby_capabilities, `${capability}:model_direct_answer_forbidden`)
        .toContain("model.direct_answer");

      const compound = buildHelixCompoundCapabilityContract({
        turnId: `ask:tool-family-parity:specialized-live-env:${capability}`.replace(/[^A-Za-z0-9:_-]+/g, "_"),
        promptText: `Call ${capability} for Helix Ask parity coverage.`,
      });
      const subgoals = compound?.subgoals ?? [];
      expect(compound?.prompt_shape, `${capability}:compound_shape`).toBe("single_capability");
      expect(subgoals, `${capability}:compound_subgoals`).toHaveLength(1);
      expect(subgoals[0]).toEqual(expect.objectContaining({
        requested_capability: capability,
        runtime_capability: capability,
        required_observation_kinds: explicit?.required_observation_kinds,
        required_terminal_kind: "model_synthesized_answer",
        forbidden_nearby_capabilities: explicit?.forbidden_nearby_capabilities,
        mandatory: true,
        status: "pending",
      }));
    }
  });

  it("keeps scholarly lookup and full-text capabilities on distinct observation rails", () => {
    const lookup = resolveToolFamilyContract({ toolName: "scholarly-research.lookup_papers" });
    expect(lookup?.toolFamily).toBe("scholarly_research");
    expect(lookup?.requiredObservationKinds).toEqual(["scholarly_research_observation"]);
    expect(lookup?.allowedTerminalKinds).toContain("scholarly_research_answer");

    const fullText = resolveToolFamilyContract({ toolName: "scholarly-research.fetch_full_text" });
    expect(fullText?.toolFamily).toBe("scholarly_research");
    expect(fullText?.requiredObservationKinds).toEqual(["scholarly_full_text_observation"]);
    expect(fullText?.allowedTerminalKinds).toContain("scholarly_research_answer");
  });

  it("keeps workspace status aligned with its explicit terminal contract", () => {
    const status = resolveToolFamilyContract({ toolName: "workspace_os.status" });
    expect(status?.toolFamily).toBe("workspace_diagnostic");
    expect(status?.requiredObservationKinds).toEqual(["workspace_os_status_observation"]);
    expect(status?.allowedTerminalKinds).toContain("model_synthesized_answer");
    expect(status?.allowedTerminalKinds).not.toContain("workspace_status_answer");
  });

  it("keeps visual capture aligned with its explicit runtime capability contract", () => {
    const routeSource = readRepoSource("server/routes/agi.plan.ts");
    const admissionSource = readRepoSource("server/services/helix-ask/tool-call-admission.ts");
    const inspect = resolveToolFamilyContract({ toolName: "image_lens.inspect" });
    expect(inspect?.toolFamily).toBe("visual_capture");
    expect(inspect?.requiredObservationKinds).toEqual([
      "visual_frame_evidence",
      "situation_context_pack",
      "visual_capture_coverage",
    ]);
    expect(inspect?.allowedTerminalKinds).toContain("situation_context_pack");
    expect(inspect?.allowedTerminalKinds).not.toContain("visual_context_pack");

    const runtime = resolveToolFamilyContract({ toolName: "situation-room.describe_visual_capture" });
    expect(runtime?.toolFamily).toBe("visual_capture");
    expect(runtime?.requiredObservationKinds).toEqual(inspect?.requiredObservationKinds);
    expect(runtime?.allowedTerminalKinds).toEqual(inspect?.allowedTerminalKinds);
    expect(routeSource).toEqual(expect.stringContaining('capabilityKey === "image_lens.inspect"'));
    expect(routeSource).toEqual(expect.stringContaining('capabilityKey === "situation-room.describe_visual_capture"'));
    expect(routeSource).toEqual(expect.stringContaining('return ["situation_run"];'));
    expect(admissionSource).toEqual(expect.stringContaining('if (sourceTarget === "visual_capture") return ["situation_run"];'));
  });

  it("keeps docs locate, summary, and equation-context terminals on distinct rails", () => {
    const locate = resolveToolFamilyContract({ toolName: "docs-viewer.locate_in_doc" });
    expect(locate?.toolFamily).toBe("docs_viewer");
    expect(locate?.requiredObservationKinds).toEqual([
      "doc_location_result",
      "doc_location_matches",
      "doc_evidence_location",
    ]);
    expect(locate?.allowedTerminalKinds).toEqual(expect.arrayContaining([
      "doc_location_result",
      "doc_location_matches",
      "doc_evidence_location",
      "doc_evidence_synthesis_answer",
    ]));
    expect(locate?.allowedTerminalKinds).not.toContain("doc_summary");
    expect(locate?.allowedTerminalKinds).not.toContain("doc_equation_context");

    const summary = resolveToolFamilyContract({ toolName: "docs-viewer.summarize_doc" });
    expect(summary?.requiredObservationKinds).toEqual(["doc_summary", "observation_review"]);
    expect(summary?.allowedTerminalKinds).toContain("doc_summary");

    const equation = resolveToolFamilyContract({ toolName: "docs-viewer.doc_equation_context" });
    expect(equation?.requiredObservationKinds).toEqual(["doc_equation_context"]);
    expect(equation?.allowedTerminalKinds).toContain("doc_equation_context");
  });

  it("keeps theory locator capabilities on distinct observation rails", () => {
    const reflection = resolveToolFamilyContract({ toolName: "helix_ask.reflect_theory_context" });
    expect(reflection?.toolFamily).toBe("theory_locator");
    expect(reflection?.requiredObservationKinds).toEqual([
      "helix_theory_context_reflection_tool_receipt",
      "theory_context_reflection",
    ]);
    expect(reflection?.requiredObservationKinds).not.toContain("theory_frontier_vector_field");
    expect(reflection?.allowedTerminalKinds).toContain("theory_context_reflection_answer");

    const frontier = resolveToolFamilyContract({ toolName: "helix.theory.frontierVectorFieldTrace" });
    expect(frontier?.toolFamily).toBe("theory_locator");
    expect(frontier?.requiredObservationKinds).toEqual([
      "helix_theory_frontier_vector_field_tool_receipt",
      "theory_frontier_vector_field",
    ]);
    expect(frontier?.requiredObservationKinds).not.toContain("theory_context_reflection");
    expect(frontier?.allowedTerminalKinds).toContain("theory_context_reflection_answer");
  });

  it("keeps moral graph reflection capabilities on distinct observation rails", () => {
    const ideology = resolveToolFamilyContract({ toolName: "helix_ask.reflect_ideology_context" });
    expect(ideology?.toolFamily).toBe("moral_graph_reflection");
    expect(ideology?.requiredObservationKinds).toEqual([
      "ideology_context_reflection/v1",
      "procedural_moral_classification/v1",
      "helix_moral_graph_reflection_tool_result",
      "workstation_tool_evaluation",
    ]);
    expect(ideology?.requiredObservationKinds).not.toContain("theory_ideology_bridge");
    expect(ideology?.allowedTerminalKinds).toContain("model_synthesized_answer");

    const bridge = resolveToolFamilyContract({ toolName: "helix_ask.bridge_theory_ideology_context" });
    expect(bridge?.toolFamily).toBe("moral_graph_reflection");
    expect(bridge?.requiredObservationKinds).toEqual([
      "helix_theory_ideology_bridge_tool_result",
      "theory_ideology_bridge",
    ]);
    expect(bridge?.requiredObservationKinds).not.toContain("procedural_moral_classification/v1");
    expect(bridge?.allowedTerminalKinds).toContain("model_synthesized_answer");
  });

  it("keeps generated workstation context-feed query tools wired through explicit and tool-family contracts", () => {
    const routeSource = readRepoSource("server/routes/agi.plan.ts");
    for (const spec of WORKSTATION_CONTEXT_FEED_QUERY_TOOL_CONTRACT_SPECS) {
      const explicit = explicitCapabilityContractForCapability(spec.capability);
      expect(routeSource, `${spec.capability}:model_visible_schema_case`)
        .toEqual(expect.stringContaining(`case "${spec.capability}":`));
      expect(explicit?.capability, `${spec.capability}:explicit_capability`).toBe(spec.capability);
      expect(explicit?.capability_family, `${spec.capability}:explicit_family`).toBe("live_environment");
      expect(explicit?.plan_family, `${spec.capability}:explicit_plan_family`).toBe("live_environment");
      expect(explicit?.source_target, `${spec.capability}:explicit_source_target`).toBe("live_environment");
      expect(explicit?.required_terminal_kind, `${spec.capability}:explicit_terminal`).toBe("model_synthesized_answer");
      expect(explicit?.aliases ?? [], `${spec.capability}:explicit_aliases`)
        .toEqual(expect.arrayContaining(spec.aliases));
      expect(explicit?.required_observation_kinds ?? [], `${spec.capability}:explicit_observations`)
        .toEqual(expect.arrayContaining([
          "live_environment_tool_observation",
          spec.explicitRequiredObservationKind,
          "helix.workstation_goal_context_update.v1",
        ]));

      const resolved = resolveToolFamilyContract({ toolName: spec.capability });
      expect(resolved?.toolFamily, `${spec.capability}:resolved_family`).toBe("live_environment");
      expect(resolved?.authority, `${spec.capability}:resolved_authority`).toBe("evidence_only");
      expect(resolved?.requiredObservationKinds ?? [], `${spec.capability}:resolved_observations`)
        .toEqual(expect.arrayContaining(explicit?.required_observation_kinds ?? []));

      const compound = buildHelixCompoundCapabilityContract({
        turnId: `ask:tool-family-parity:context-feed-query:${spec.capability}`.replace(/[^A-Za-z0-9:_-]+/g, "_"),
        promptText: `Call ${spec.capability} for Helix Ask parity coverage.`,
      });
      const subgoals = compound?.subgoals ?? [];
      expect(compound?.schema, `${spec.capability}:compound_schema`)
        .toBe("helix.compound_capability_contract.v1");
      expect(compound?.prompt_shape, `${spec.capability}:compound_shape`).toBe("single_capability");
      expect(subgoals, `${spec.capability}:compound_subgoals`).toHaveLength(1);
      expect(subgoals[0]).toEqual(expect.objectContaining({
        requested_capability: spec.capability,
        runtime_capability: spec.capability,
        required_observation_kinds: explicit?.required_observation_kinds,
        required_terminal_kind: "model_synthesized_answer",
        mandatory: true,
        status: "pending",
      }));
    }
  });

  it("keeps every explicit required terminal kind allowed by the resolved tool-family policy", () => {
    for (const contract of explicitCapabilityContractsForTests) {
      const resolved = resolveToolFamilyContract({ toolName: contract.capability });
      expect(resolved, `${contract.capability}:resolved`).toBeTruthy();
      expect(
        resolved?.allowedTerminalKinds,
        `${contract.capability}:required_terminal_kind:${contract.required_terminal_kind}`,
      ).toContain(contract.required_terminal_kind);

      if (contract.runtime_capability && contract.runtime_capability !== contract.capability) {
        const runtimeResolved = resolveToolFamilyContract({ toolName: contract.runtime_capability });
        expect(runtimeResolved, `${contract.capability}:runtime:${contract.runtime_capability}:resolved`)
          .toBeTruthy();
        expect(
          runtimeResolved?.allowedTerminalKinds,
          `${contract.capability}:runtime:${contract.runtime_capability}:required_terminal_kind:${contract.required_terminal_kind}`,
        ).toContain(contract.required_terminal_kind);
      }
    }
  });

  it("keeps every explicit required observation kind known to the resolved tool-family policy", () => {
    for (const contract of explicitCapabilityContractsForTests) {
      const resolved = resolveToolFamilyContract({ toolName: contract.capability });
      expect(resolved, `${contract.capability}:resolved`).toBeTruthy();
      expect(
        resolved?.requiredObservationKinds,
        `${contract.capability}:required_observation_kinds`,
      ).toEqual(expect.arrayContaining(contract.required_observation_kinds));

      if (contract.runtime_capability && contract.runtime_capability !== contract.capability) {
        const runtimeResolved = resolveToolFamilyContract({ toolName: contract.runtime_capability });
        expect(runtimeResolved, `${contract.capability}:runtime:${contract.runtime_capability}:resolved`)
          .toBeTruthy();
        expect(
          runtimeResolved?.requiredObservationKinds,
          `${contract.capability}:runtime:${contract.runtime_capability}:required_observation_kinds`,
        ).toEqual(expect.arrayContaining(contract.required_observation_kinds));
      }
    }
  });

  it("keeps runtime capabilities and allowed substitutions tied to the explicit contract", () => {
    for (const contract of explicitCapabilityContractsForTests) {
      const substitutingCapabilities = Array.from(new Set([
        contract.runtime_capability && contract.runtime_capability !== contract.capability
          ? contract.runtime_capability
          : "",
        ...contract.allowed_substitutions,
      ].filter(Boolean)));

      for (const capability of substitutingCapabilities) {
        const capabilityContract = explicitCapabilityContractForCapability(capability);
        expect(capabilityContract, `${contract.capability}:substitution:${capability}:contract`)
          .toBeTruthy();
        if (capabilityContract?.capability !== contract.capability) {
          expect(
            capabilityContract?.capability === capability ||
              capabilityContract?.runtime_capability === capability,
            `${contract.capability}:substitution:${capability}:explicit_substitute_identity`,
          ).toBe(true);
          expect(
            capabilityContract?.capability_family,
            `${contract.capability}:substitution:${capability}:substitute_family`,
          ).toBe(contract.capability_family);
        }
        expect(
          explicitCapabilityMatches(contract.capability, capability),
          `${contract.capability}:substitution:${capability}:match`,
        ).toBe(true);

        const resolved = resolveToolFamilyContract({ toolName: capability });
        expect(resolved, `${contract.capability}:substitution:${capability}:resolved`).toBeTruthy();
        const expectedObservationKinds = capabilityContract?.capability === contract.capability
          ? contract.required_observation_kinds
          : capabilityContract?.required_observation_kinds ?? [];
        const expectedTerminalKind = capabilityContract?.capability === contract.capability
          ? contract.required_terminal_kind
          : capabilityContract?.required_terminal_kind ?? contract.required_terminal_kind;
        expect(
          resolved?.allowedTerminalKinds,
          `${contract.capability}:substitution:${capability}:required_terminal_kind:${expectedTerminalKind}`,
        ).toContain(expectedTerminalKind);
        expect(
          resolved?.requiredObservationKinds,
          `${contract.capability}:substitution:${capability}:required_observation_kinds`,
        ).toEqual(expect.arrayContaining(expectedObservationKinds));
      }
    }
  });

  it("matches explicit capabilities across normalized runtime key spellings", () => {
    expect(explicitCapabilityMatches("image_lens.inspect", "situation_room_describe_visual_capture"))
      .toBe(true);
    expect(explicitCapabilityContractForCapability("situation_room_describe_visual_capture")?.capability)
      .toBe("image_lens.inspect");
  });

  it("keeps every named audit tool call backed by an explicit capability contract", () => {
    for (const capability of auditedExplicitCapabilities) {
      expect(contractCapabilities.has(capability), capability).toBe(true);
    }
    for (const capability of objectiveRepresentativeCapabilities) {
      expect(auditedExplicitCapabilities).toContain(capability);
    }
  });

  it("keeps reflection and civilization capabilities from becoming arg-free contracts", () => {
    const requiredArgExpectations = new Map<string, string[]>([
      ["helix_ask.reflect_theory_context", ["prompt"]],
      ["helix.theory.frontierVectorFieldTrace", ["query"]],
      ["helix_ask.reflect_live_synthetic_data", ["prompt"]],
      ["helix_ask.reflect_context_attachments", ["prompt"]],
      ["helix_ask.reflect_ideology_context", ["text"]],
      ["helix_ask.bridge_theory_ideology_context", ["prompt"]],
      ["helix_ask.build_civilization_scenario_frame", ["prompt"]],
      ["helix_ask.reflect_civilization_bounds", ["prompt"]],
    ]);

    for (const [capability, requiredArgs] of requiredArgExpectations) {
      const contract = explicitCapabilityContractForCapability(capability);
      expect(contract?.required_args, capability).toEqual(requiredArgs);
    }
  });

  it("extracts representative explicit capability prompts into usable single-subgoal contracts", () => {
    for (const entry of objectiveFamilyCoverage) {
      for (const capability of entry.representativeCapabilities) {
        const contract = explicitCapabilityContractsForTests.find((candidate) =>
          candidate.capability === capability ||
          candidate.runtime_capability === capability ||
          (candidate.aliases ?? []).includes(capability)
        );
        expect(contract, `${entry.label}:${capability}:contract`).toBeTruthy();
        expect(contract?.required_observation_kinds.length, `${entry.label}:${capability}:observations`)
          .toBeGreaterThan(0);
        expect(contract?.required_terminal_kind, `${entry.label}:${capability}:terminal_kind`).toBeTruthy();
        expect(Array.isArray(contract?.forbidden_nearby_capabilities), `${entry.label}:${capability}:forbidden`)
          .toBe(true);

        const compound = buildHelixCompoundCapabilityContract({
          turnId: `ask:tool-family-parity:${entry.label}:${capability}`.replace(/[^A-Za-z0-9:_-]+/g, "_"),
          promptText: promptForRepresentativeCapability(capability),
        });
        const subgoals = compound?.subgoals ?? [];
        expect(compound?.schema, `${entry.label}:${capability}:schema`)
          .toBe("helix.compound_capability_contract.v1");
        expect(compound?.prompt_shape, `${entry.label}:${capability}:shape`).toBe("single_capability");
        expect(subgoals, `${entry.label}:${capability}:subgoals`).toHaveLength(1);
        expect(subgoals[0]).toEqual(expect.objectContaining({
          requested_capability: contract?.capability,
          runtime_capability: contract?.runtime_capability ?? contract?.capability,
          required_observation_kinds: contract?.required_observation_kinds,
          required_terminal_kind: contract?.required_terminal_kind,
          mandatory: true,
          status: "pending",
        }));
        for (const requiredArg of contract?.required_args ?? []) {
          expect(
            argObjectSatisfiesRequiredArg(
              subgoals[0]?.args_hint as Record<string, unknown> | null | undefined,
              contract?.capability ?? "",
              requiredArg,
            ),
            `${entry.label}:${capability}:required_arg:${requiredArg}:args_hint`,
          ).toBe(true);
        }
      }
    }
  });

  it("extracts every explicit capability prompt into a usable single-subgoal contract", () => {
    for (const contract of explicitCapabilityContractsForTests) {
      const compound = buildHelixCompoundCapabilityContract({
        turnId: `ask:tool-family-parity:all-explicit:${contract.capability}`.replace(/[^A-Za-z0-9:_-]+/g, "_"),
        promptText: promptForRepresentativeCapability(contract.capability),
      });
      const subgoals = compound?.subgoals ?? [];
      expect(compound?.schema, `${contract.capability}:schema`)
        .toBe("helix.compound_capability_contract.v1");
      expect(compound?.prompt_shape, `${contract.capability}:shape`).toBe("single_capability");
      expect(subgoals, `${contract.capability}:subgoals`).toHaveLength(1);
      expect(subgoals[0]).toEqual(expect.objectContaining({
        requested_capability: contract.capability,
        runtime_capability: contract.runtime_capability ?? contract.capability,
        required_observation_kinds: contract.required_observation_kinds,
        required_terminal_kind: contract.required_terminal_kind,
        allowed_substitutions: contract.allowed_substitutions,
        forbidden_nearby_capabilities: contract.forbidden_nearby_capabilities,
        mandatory: true,
        status: "pending",
      }));
      for (const requiredArg of contract.required_args) {
        expect(
          argObjectSatisfiesRequiredArg(
            subgoals[0]?.args_hint as Record<string, unknown> | null | undefined,
            contract.capability,
            requiredArg,
          ),
          `${contract.capability}:required_arg:${requiredArg}:args_hint`,
        ).toBe(true);
      }
    }
  });

  it("maps safe family-label commands to their explicit capability contracts", () => {
    for (const entry of familyLabelCommandPrompts) {
      const compound = buildHelixCompoundCapabilityContract({
        turnId: `ask:tool-family-parity:family-label:${entry.label}`,
        promptText: entry.prompt,
      });
      const subgoals = compound?.subgoals ?? [];
      expect(compound?.schema, `${entry.label}:schema`)
        .toBe("helix.compound_capability_contract.v1");
      expect(compound?.prompt_shape, `${entry.label}:shape`).toBe("single_capability");
      expect(subgoals, `${entry.label}:subgoals`).toHaveLength(1);
      expect(subgoals[0]?.requested_capability, entry.label).toBe(entry.expectedCapability);
      const contract = explicitCapabilityContractForCapability(entry.expectedCapability);
      for (const requiredArg of contract?.required_args ?? []) {
        expect(
          argObjectSatisfiesRequiredArg(
            subgoals[0]?.args_hint as Record<string, unknown> | null | undefined,
            contract?.capability ?? "",
            requiredArg,
          ),
          `${entry.label}:${entry.expectedCapability}:required_arg:${requiredArg}:args_hint`,
        ).toBe(true);
      }
    }
  });

  it("maps natural runtime tool-catalog questions to the capability catalog contract", () => {
    for (const promptText of naturalCapabilityCatalogPrompts) {
      const compound = buildHelixCompoundCapabilityContract({
        turnId: "ask:tool-family-parity:natural-capability-catalog",
        promptText,
      });
      const subgoals = compound?.subgoals ?? [];
      expect(compound?.schema, promptText).toBe("helix.compound_capability_contract.v1");
      expect(compound?.prompt_shape, promptText).toBe("single_capability");
      expect(subgoals, promptText).toHaveLength(1);
      expect(subgoals[0]?.requested_capability, promptText)
        .toBe("helix_ask.inspect_capability_catalog");
      expect(subgoals[0]?.required_terminal_kind, promptText).toBe("capability_help_summary");
      expect(subgoals[0]?.required_observation_kinds, promptText)
        .toEqual(["capability_registry"]);
    }
  });

  it("keeps the deterministic catalog fast path on the shared capability arbitration spine", () => {
    const routeSource = readRepoSource("server/routes/agi.plan.ts");
    expect(routeSource).toEqual(expect.stringContaining("const capabilityContractArbitration = {"));
    expect(routeSource).toEqual(expect.stringContaining('schema: "helix.ask_capability_contract_arbitration.v1"'));
    expect(routeSource).toEqual(expect.stringContaining('contract_state: "explicit_capability_command"'));
    expect(routeSource).toEqual(expect.stringContaining("requested_capability: HELIX_ASK_CAPABILITY_CATALOG_CAPABILITY"));
    expect(routeSource).toEqual(expect.stringContaining('selected_plan_family: "capability_catalog"'));
    expect(routeSource).toEqual(expect.stringContaining('required_terminal_kind: "capability_help_summary"'));
    expect(routeSource).toEqual(expect.stringContaining("capability_contract_arbitration: capabilityContractArbitration"));
    expect(routeSource).toEqual(expect.stringContaining("debug: parsed.data.debug"));
  });

  it("does not turn contextual tool-catalog mentions into compound subgoals", () => {
    for (const promptText of contextualCapabilityCatalogPrompts) {
      const compound = buildHelixCompoundCapabilityContract({
        turnId: "ask:tool-family-parity:contextual-capability-catalog",
        promptText,
      });
      expect(compound, promptText).toBeNull();
    }
  });

  it("preserves a natural catalog request before a later explicit tool subgoal", () => {
    const compound = buildHelixCompoundCapabilityContract({
      turnId: "ask:tool-family-parity:natural-catalog-then-workspace",
      promptText:
        "What tools are available for the helix ask to use? Then use workspace_os.status to inspect workstation status.",
    });
    const subgoals = compound?.subgoals ?? [];
    expect(compound?.schema).toBe("helix.compound_capability_contract.v1");
    expect(compound?.prompt_shape).toBe("compound_capability");
    expect(subgoals.map((subgoal) => subgoal.requested_capability)).toEqual([
      "helix_ask.inspect_capability_catalog",
      "workspace_os.status",
    ]);
    expect(compound?.requires_all_subgoals).toBe(true);
  });

  it("preserves a natural catalog request after an earlier explicit tool subgoal", () => {
    const compound = buildHelixCompoundCapabilityContract({
      turnId: "ask:tool-family-parity:workspace-then-natural-catalog",
      promptText:
        "Please                                                  use workspace_os.status to inspect workstation status, then tell me what tools are available for the Helix Ask to use.",
    });
    const subgoals = compound?.subgoals ?? [];
    expect(compound?.schema).toBe("helix.compound_capability_contract.v1");
    expect(compound?.prompt_shape).toBe("compound_capability");
    expect(subgoals.map((subgoal) => subgoal.requested_capability)).toEqual([
      "workspace_os.status",
      "helix_ask.inspect_capability_catalog",
    ]);
    expect(compound?.requires_all_subgoals).toBe(true);
  });

  it("keeps family-label catalog and workspace status prompts as ordered subgoals", () => {
    const compound = buildHelixCompoundCapabilityContract({
      turnId: "ask:tool-family-parity:catalog-family-then-workspace-family",
      promptText:
        "Call capability_catalog to list available tools, then call workspace_status to inspect workstation status.",
    });
    const subgoals = compound?.subgoals ?? [];
    expect(compound?.schema).toBe("helix.compound_capability_contract.v1");
    expect(compound?.prompt_shape).toBe("compound_capability");
    expect(subgoals.map((subgoal) => subgoal.requested_capability)).toEqual([
      "helix_ask.inspect_capability_catalog",
      "workspace_os.status",
    ]);
    expect(compound?.requires_all_subgoals).toBe(true);
  });

  it("binds workspace status observations into a later calculator subgoal", () => {
    const compound = buildHelixCompoundCapabilityContract({
      turnId: "ask:tool-family-parity:workspace-status-then-calculator",
      promptText:
        "Use workspace_os.status to inspect workstation status, then call scientific-calculator.solve_expression with this exact expression: 14*23+8.",
    });
    const subgoals = compound?.subgoals ?? [];
    expect(compound?.schema).toBe("helix.compound_capability_contract.v1");
    expect(compound?.prompt_shape).toBe("compound_capability");
    expect(subgoals.map((subgoal) => subgoal.requested_capability)).toEqual([
      "workspace_os.status",
      "scientific-calculator.solve_expression",
    ]);
    expect(subgoals[1]?.input_bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        arg_name: "support_refs",
        binding_kind: "support_ref",
        from_capability: "workspace_os.status",
        required: true,
      }),
    ]));
    expect(subgoals[1]?.args_hint).toMatchObject({
      latex: "14*23+8",
      expression: "14*23+8",
    });
  });

  it("keeps micro-reasoner preset query, draft, and route prompts ordered", () => {
    const compound = buildHelixCompoundCapabilityContract({
      turnId: "ask:tool-family-parity:micro-reasoner-preset-route",
      promptText:
        "Use micro_reasoner_presets to inspect the preset catalog, then use micro_reasoner_preset_draft to draft a preset for scenario text: noisy live-source transcript, then use microdeck_prompt_router to route source summary: noisy live-source transcript.",
    });
    const subgoals = compound?.subgoals ?? [];
    expect(compound?.schema).toBe("helix.compound_capability_contract.v1");
    expect(compound?.prompt_shape).toBe("compound_capability");
    expect(subgoals.map((subgoal) => subgoal.requested_capability)).toEqual([
      "live_env.query_micro_reasoner_presets",
      "live_env.draft_micro_reasoner_preset",
      "live_env.route_micro_reasoner_prompt",
    ]);
    expect(subgoals[0]?.required_args).toEqual([]);
    expect(subgoals[0]?.optional_args).toEqual(expect.arrayContaining(["query", "include_presets", "limit"]));
    expect(subgoals[1]?.required_args).toEqual(["scenario_text"]);
    expect(subgoals[1]?.optional_args).toEqual(expect.arrayContaining(["base_preset_id", "candidate_prompts"]));
    expect(subgoals[2]?.required_args).toEqual(["source_summary"]);
    expect(subgoals[2]?.optional_args).toEqual(expect.arrayContaining(["candidate_prompts"]));
    expect(subgoals[1]?.depends_on_subgoal_ids).toEqual([subgoals[0]?.subgoal_id]);
    expect(subgoals[2]?.depends_on_subgoal_ids).toEqual([
      subgoals[0]?.subgoal_id,
      subgoals[1]?.subgoal_id,
    ]);
    expect(subgoals[0]?.args_hint).toMatchObject({
      include_presets: true,
      limit: 100,
    });
    expect(subgoals[1]?.args_hint).toMatchObject({
      scenario_text: expect.stringContaining("noisy live-source transcript"),
      base_preset_id: "stage_play_micro_reasoner_prompt_preset:generic-live-source:v1",
    });
    expect(subgoals[2]?.args_hint).toMatchObject({
      source_summary: expect.stringContaining("noisy live-source transcript"),
      candidate_prompts: [expect.stringContaining("noisy live-source transcript")],
    });
    expect(compound?.requires_all_subgoals).toBe(true);
  });

  it("keeps action-qualified docs viewer family prompts ordered before calculator subgoals", () => {
    const compound = buildHelixCompoundCapabilityContract({
      turnId: "ask:tool-family-parity:docs-family-label-then-calculator",
      promptText:
        "Use docs_viewer to locate query: rule of thumb, then run calculator with this exact expression: 19+23.",
    });
    const subgoals = compound?.subgoals ?? [];
    expect(compound?.schema).toBe("helix.compound_capability_contract.v1");
    expect(compound?.prompt_shape).toBe("compound_capability");
    expect(subgoals.map((subgoal) => subgoal.requested_capability)).toEqual([
      "docs-viewer.locate_in_doc",
      "scientific-calculator.solve_expression",
    ]);
    expect(subgoals[1]?.args_hint).toMatchObject({
      latex: "19+23",
      expression: "19+23",
    });
  });

  it("keeps action-qualified live-source mailbox prompts ordered through read/process/reflect", () => {
    const compound = buildHelixCompoundCapabilityContract({
      turnId: "ask:tool-family-parity:live-source-mail-family-chain",
      promptText:
        "Use live_source_mail to read processed mail, then use live_source_mail to process current mail, then use live_source_mail to reflect on the mailbox loop.",
    });
    const subgoals = compound?.subgoals ?? [];
    expect(compound?.schema).toBe("helix.compound_capability_contract.v1");
    expect(compound?.prompt_shape).toBe("compound_capability");
    expect(subgoals.map((subgoal) => subgoal.requested_capability)).toEqual([
      "live_env.read_processed_live_source_mail",
      "live_env.process_live_source_mail",
      "live_env.reflect_live_source_mail_loop",
    ]);
    expect(subgoals[1]?.input_bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        from_capability: "live_env.read_processed_live_source_mail",
        required: true,
      }),
    ]));
    expect(subgoals[2]?.input_bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        from_capability: "live_env.read_processed_live_source_mail",
        required: true,
      }),
      expect.objectContaining({
        from_capability: "live_env.process_live_source_mail",
        required: true,
      }),
    ]));
  });

  it("binds live-source read and process observations into a later mail decision subgoal", () => {
    const compound = buildHelixCompoundCapabilityContract({
      turnId: "ask:tool-family-parity:live-source-mail-decision-chain",
      promptText:
        "Call live_env.read_processed_live_source_mail, then call live_env.process_live_source_mail, then call live_env.record_live_source_mail_decision.",
    });
    const subgoals = compound?.subgoals ?? [];
    expect(compound?.schema).toBe("helix.compound_capability_contract.v1");
    expect(compound?.prompt_shape).toBe("compound_capability");
    expect(subgoals.map((subgoal) => subgoal.requested_capability)).toEqual([
      "live_env.read_processed_live_source_mail",
      "live_env.process_live_source_mail",
      "live_env.record_live_source_mail_decision",
    ]);
    expect(subgoals[2]?.input_bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        arg_name: "evidence_refs",
        binding_kind: "support_ref",
        from_capability: "live_env.read_processed_live_source_mail",
        required: true,
      }),
      expect.objectContaining({
        arg_name: "evidence_refs",
        binding_kind: "support_ref",
        from_capability: "live_env.process_live_source_mail",
        required: true,
      }),
    ]));
  });

  it("binds live-source quality and goal context into current-state summary", () => {
    const compound = buildHelixCompoundCapabilityContract({
      turnId: "ask:tool-family-parity:live-source-quality-goal-context-state",
      promptText:
        "Call live_env.query_live_source_quality, then call live_env.query_workstation_goal_context, then call live_env.summarize_live_source_current_state.",
    });
    const subgoals = compound?.subgoals ?? [];
    expect(compound?.schema).toBe("helix.compound_capability_contract.v1");
    expect(compound?.prompt_shape).toBe("compound_capability");
    expect(subgoals.map((subgoal) => subgoal.requested_capability)).toEqual([
      "live_env.query_live_source_quality",
      "live_env.query_workstation_goal_context",
      "live_env.summarize_live_source_current_state",
    ]);
    expect(subgoals[2]?.input_bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        arg_name: "source_refs",
        binding_kind: "source_ref",
        from_capability: "live_env.query_live_source_quality",
        required: true,
      }),
      expect.objectContaining({
        arg_name: "source_refs",
        binding_kind: "source_ref",
        from_capability: "live_env.query_workstation_goal_context",
        required: true,
      }),
    ]));
  });

  it("binds repo evidence into a theory locator family-label reflection subgoal", () => {
    const compound = buildHelixCompoundCapabilityContract({
      turnId: "ask:tool-family-parity:repo-then-theory-locator",
      promptText:
        "Use repo_code for query: terminal authority, then use theory_locator for Helix Ask parity coverage.",
    });
    const subgoals = compound?.subgoals ?? [];
    expect(compound?.schema).toBe("helix.compound_capability_contract.v1");
    expect(compound?.prompt_shape).toBe("compound_capability");
    expect(subgoals.map((subgoal) => subgoal.requested_capability)).toEqual([
      "repo-code.search_concept",
      "helix_ask.reflect_theory_context",
    ]);
    expect(subgoals[1]?.input_bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        arg_name: "source_ref",
        binding_kind: "source_ref",
        from_capability: "repo-code.search_concept",
        required: true,
      }),
    ]));
  });

  it("binds docs evidence into a theory locator reflection subgoal", () => {
    const compound = buildHelixCompoundCapabilityContract({
      turnId: "ask:tool-family-parity:docs-then-theory-locator",
      promptText:
        "Use docs-viewer.locate_in_doc to locate query: rule of thumb, then use theory_locator for Helix Ask parity coverage.",
    });
    const subgoals = compound?.subgoals ?? [];
    expect(compound?.schema).toBe("helix.compound_capability_contract.v1");
    expect(compound?.prompt_shape).toBe("compound_capability");
    expect(subgoals.map((subgoal) => subgoal.requested_capability)).toEqual([
      "docs-viewer.locate_in_doc",
      "helix_ask.reflect_theory_context",
    ]);
    expect(subgoals[1]?.input_bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        arg_name: "source_ref",
        binding_kind: "source_ref",
        from_capability: "docs-viewer.locate_in_doc",
        required: true,
      }),
    ]));
  });

  it("binds repo evidence through reflection before calculator synthesis", () => {
    const compound = buildHelixCompoundCapabilityContract({
      turnId: "ask:tool-family-parity:repo-reflection-calculator-bindings",
      promptText:
        "Use repo-code.search_concept for query: terminal authority, then use helix_ask.reflect_theory_context to explain the repo evidence, then run scientific-calculator.solve_expression with this exact expression: 4*13.",
    });
    const subgoals = compound?.subgoals ?? [];
    expect(compound?.schema).toBe("helix.compound_capability_contract.v1");
    expect(compound?.prompt_shape).toBe("compound_capability");
    expect(subgoals.map((subgoal) => subgoal.requested_capability)).toEqual([
      "repo-code.search_concept",
      "helix_ask.reflect_theory_context",
      "scientific-calculator.solve_expression",
    ]);

    const repoArgs = subgoals[0]?.args_hint as Record<string, unknown> | undefined;
    expect(String(repoArgs?.query ?? "")).toContain("terminal authority");
    expect(String(repoArgs?.query ?? "")).not.toContain("reflect_theory_context");

    const reflectionArgs = subgoals[1]?.args_hint as Record<string, unknown> | undefined;
    const reflectionPrompt = String(reflectionArgs?.prompt ?? "");
    expect(reflectionPrompt).toContain("explain the repo evidence");
    expect(reflectionPrompt).not.toContain("scientific-calculator");
    expect(reflectionPrompt).not.toContain("4*13");
    expect(subgoals[1]?.input_bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        arg_name: "source_ref",
        binding_kind: "source_ref",
        from_capability: "repo-code.search_concept",
        required: true,
      }),
    ]));

    expect(subgoals[2]?.input_bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        arg_name: "support_refs",
        binding_kind: "support_ref",
        from_capability: "repo-code.search_concept",
        required: true,
      }),
      expect.objectContaining({
        arg_name: "support_refs",
        binding_kind: "support_ref",
        from_capability: "helix_ask.reflect_theory_context",
        required: true,
      }),
    ]));
    expect(subgoals[2]?.args_hint).toMatchObject({
      latex: "4*13",
      expression: "4*13",
    });
  });

  it("binds docs evidence through reflection before calculator synthesis", () => {
    const compound = buildHelixCompoundCapabilityContract({
      turnId: "ask:tool-family-parity:docs-reflection-calculator-bindings",
      promptText:
        "Use docs-viewer.locate_in_doc to locate query: receipts are observations, then use helix_ask.reflect_theory_context to explain the document evidence, then run scientific-calculator.solve_expression with this exact expression: 7*8.",
    });
    const subgoals = compound?.subgoals ?? [];
    expect(compound?.schema).toBe("helix.compound_capability_contract.v1");
    expect(compound?.prompt_shape).toBe("compound_capability");
    expect(subgoals.map((subgoal) => subgoal.requested_capability)).toEqual([
      "docs-viewer.locate_in_doc",
      "helix_ask.reflect_theory_context",
      "scientific-calculator.solve_expression",
    ]);

    const docsArgs = subgoals[0]?.args_hint as Record<string, unknown> | undefined;
    expect(String(docsArgs?.query ?? "")).toContain("receipts are observations");
    expect(String(docsArgs?.query ?? "")).not.toContain("reflect_theory_context");

    const reflectionArgs = subgoals[1]?.args_hint as Record<string, unknown> | undefined;
    const reflectionPrompt = String(reflectionArgs?.prompt ?? "");
    expect(reflectionPrompt).toContain("explain the document evidence");
    expect(reflectionPrompt).not.toContain("scientific-calculator");
    expect(reflectionPrompt).not.toContain("7*8");
    expect(subgoals[1]?.input_bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        arg_name: "source_ref",
        binding_kind: "source_ref",
        from_capability: "docs-viewer.locate_in_doc",
        required: true,
      }),
    ]));

    expect(subgoals[2]?.input_bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        arg_name: "support_refs",
        binding_kind: "support_ref",
        from_capability: "docs-viewer.locate_in_doc",
        required: true,
      }),
      expect.objectContaining({
        arg_name: "support_refs",
        binding_kind: "support_ref",
        from_capability: "helix_ask.reflect_theory_context",
        required: true,
      }),
    ]));
    expect(subgoals[2]?.args_hint).toMatchObject({
      latex: "7*8",
      expression: "7*8",
    });
  });

  it("keeps research-reflection-calculator subgoal args bounded to their own instructions", () => {
    const compound = buildHelixCompoundCapabilityContract({
      turnId: "ask:tool-family-parity:internet-reflection-calculator-bounded-args",
      promptText:
        "Use internet_search.web_research to find a cited research-paper source for Alcubierre metric energy estimates, then use helix_ask.reflect_theory_context to connect that source to the Helix Ask receipts-as-observations rule, then run scientific-calculator.solve_expression with this exact expression: (9+3)*7-25.",
    });
    const subgoals = compound?.subgoals ?? [];
    expect(compound?.schema).toBe("helix.compound_capability_contract.v1");
    expect(compound?.prompt_shape).toBe("compound_capability");
    expect(subgoals.map((subgoal) => subgoal.requested_capability)).toEqual([
      "internet_search.web_research",
      "helix_ask.reflect_theory_context",
      "scientific-calculator.solve_expression",
    ]);

    const researchArgs = subgoals[0]?.args_hint as Record<string, unknown> | undefined;
    expect(String(researchArgs?.query ?? "")).toContain("Alcubierre metric energy estimates");
    expect(String(researchArgs?.query ?? "")).not.toContain("reflect_theory_context");

    const reflectionArgs = subgoals[1]?.args_hint as Record<string, unknown> | undefined;
    const reflectionPrompt = String(reflectionArgs?.prompt ?? "");
    expect(reflectionPrompt).toContain("connect that source");
    expect(reflectionPrompt).toContain("receipts-as-observations");
    expect(reflectionPrompt).not.toContain("scientific-calculator");
    expect(reflectionPrompt).not.toContain("(9+3)*7-25");
    expect(subgoals[1]?.input_bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        arg_name: "source_ref",
        binding_kind: "source_ref",
        from_capability: "internet_search.web_research",
        required: true,
      }),
    ]));

    expect(subgoals[2]?.input_bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        arg_name: "support_refs",
        binding_kind: "support_ref",
        from_capability: "internet_search.web_research",
        required: true,
      }),
      expect.objectContaining({
        arg_name: "support_refs",
        binding_kind: "support_ref",
        from_capability: "helix_ask.reflect_theory_context",
        required: true,
      }),
    ]));
    expect(subgoals[2]?.args_hint).toMatchObject({
      latex: "(9+3)*7-25",
      expression: "(9+3)*7-25",
    });
  });

  it("binds scholarly lookup evidence into reflection and calculator subgoals without widening calculator args", () => {
    const compound = buildHelixCompoundCapabilityContract({
      turnId: "ask:tool-family-parity:scholarly-reflection-calculator-bounded-args",
      promptText:
        "Use scholarly-research.lookup_papers for Alcubierre metric energy estimates, then use helix_ask.reflect_theory_context to connect that scholarly source to the Helix Ask receipts-as-observations rule, then run scientific-calculator.solve_expression with this exact expression: (12+5)*3.",
    });
    const subgoals = compound?.subgoals ?? [];
    expect(compound?.schema).toBe("helix.compound_capability_contract.v1");
    expect(compound?.prompt_shape).toBe("compound_capability");
    expect(subgoals.map((subgoal) => subgoal.requested_capability)).toEqual([
      "scholarly-research.lookup_papers",
      "helix_ask.reflect_theory_context",
      "scientific-calculator.solve_expression",
    ]);

    const lookupArgs = subgoals[0]?.args_hint as Record<string, unknown> | undefined;
    expect(String(lookupArgs?.query ?? "")).toContain("Alcubierre metric energy estimates");
    expect(String(lookupArgs?.query ?? "")).not.toContain("reflect_theory_context");

    const reflectionArgs = subgoals[1]?.args_hint as Record<string, unknown> | undefined;
    const reflectionPrompt = String(reflectionArgs?.prompt ?? "");
    expect(reflectionPrompt).toContain("connect that scholarly source");
    expect(reflectionPrompt).toContain("receipts-as-observations");
    expect(reflectionPrompt).not.toContain("scientific-calculator");
    expect(reflectionPrompt).not.toContain("(12+5)*3");
    expect(subgoals[1]?.input_bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        arg_name: "source_ref",
        binding_kind: "source_ref",
        from_capability: "scholarly-research.lookup_papers",
        required: true,
      }),
    ]));

    expect(subgoals[2]?.input_bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        arg_name: "support_refs",
        binding_kind: "support_ref",
        from_capability: "scholarly-research.lookup_papers",
        required: true,
      }),
      expect.objectContaining({
        arg_name: "support_refs",
        binding_kind: "support_ref",
        from_capability: "helix_ask.reflect_theory_context",
        required: true,
      }),
    ]));
    expect(subgoals[2]?.args_hint).toMatchObject({
      latex: "(12+5)*3",
      expression: "(12+5)*3",
    });
  });

  it("binds scholarly full-text evidence through reflection before calculator synthesis", () => {
    const compound = buildHelixCompoundCapabilityContract({
      turnId: "ask:tool-family-parity:scholarly-full-text-reflection-calculator-bindings",
      promptText:
        "Use scholarly-research.lookup_papers for Alcubierre metric energy estimates, then use scholarly-research.fetch_full_text, then use helix_ask.reflect_theory_context to connect that paper evidence to the Helix Ask receipts-as-observations rule, then run scientific-calculator.solve_expression with this exact expression: (2.5+1.5)*8.",
    });
    const subgoals = compound?.subgoals ?? [];
    expect(compound?.schema).toBe("helix.compound_capability_contract.v1");
    expect(compound?.prompt_shape).toBe("compound_capability");
    expect(subgoals.map((subgoal) => subgoal.requested_capability)).toEqual([
      "scholarly-research.lookup_papers",
      "scholarly-research.fetch_full_text",
      "helix_ask.reflect_theory_context",
      "scientific-calculator.solve_expression",
    ]);

    expect(subgoals[1]?.input_bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        arg_name: "paper_result_or_source",
        binding_kind: "source_ref",
        from_capability: "scholarly-research.lookup_papers",
        required: true,
      }),
    ]));
    expect(subgoals[2]?.input_bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        arg_name: "source_refs",
        binding_kind: "source_ref",
        from_capability: "scholarly-research.lookup_papers",
        required: true,
      }),
      expect.objectContaining({
        arg_name: "source_refs",
        binding_kind: "source_ref",
        from_capability: "scholarly-research.fetch_full_text",
        required: true,
      }),
    ]));
    expect(subgoals[3]?.input_bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        arg_name: "support_refs",
        binding_kind: "support_ref",
        from_capability: "scholarly-research.lookup_papers",
        required: true,
      }),
      expect.objectContaining({
        arg_name: "support_refs",
        binding_kind: "support_ref",
        from_capability: "scholarly-research.fetch_full_text",
        required: true,
      }),
      expect.objectContaining({
        arg_name: "support_refs",
        binding_kind: "support_ref",
        from_capability: "helix_ask.reflect_theory_context",
        required: true,
      }),
    ]));
    expect(subgoals[3]?.args_hint).toMatchObject({
      latex: "(2.5+1.5)*8",
      expression: "(2.5+1.5)*8",
    });
  });

  it("binds context reflection into a later calculator subgoal without widening calculator args", () => {
    const compound = buildHelixCompoundCapabilityContract({
      turnId: "ask:tool-family-parity:context-reflection-then-calculator",
      promptText:
        "Use context_reflection to inspect attachments, then run calculator with this exact expression: 3*11.",
    });
    const subgoals = compound?.subgoals ?? [];
    expect(compound?.schema).toBe("helix.compound_capability_contract.v1");
    expect(compound?.prompt_shape).toBe("compound_capability");
    expect(subgoals.map((subgoal) => subgoal.requested_capability)).toEqual([
      "helix_ask.reflect_context_attachments",
      "scientific-calculator.solve_expression",
    ]);
    expect(subgoals[1]?.input_bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        arg_name: "support_refs",
        binding_kind: "support_ref",
        from_capability: "helix_ask.reflect_context_attachments",
        required: true,
      }),
    ]));
    expect(subgoals[1]?.args_hint).toMatchObject({
      latex: "3*11",
      expression: "3*11",
    });
  });

  it("binds theory frontier trace observations into a later calculator subgoal", () => {
    const compound = buildHelixCompoundCapabilityContract({
      turnId: "ask:tool-family-parity:theory-frontier-trace-then-calculator",
      promptText:
        "Call frontierVectorFieldTrace for Helix Ask parity coverage, then run calculator with this exact expression: 6*7.",
    });
    const subgoals = compound?.subgoals ?? [];
    expect(compound?.schema).toBe("helix.compound_capability_contract.v1");
    expect(compound?.prompt_shape).toBe("compound_capability");
    expect(subgoals.map((subgoal) => subgoal.requested_capability)).toEqual([
      "helix.theory.frontierVectorFieldTrace",
      "scientific-calculator.solve_expression",
    ]);
    expect(subgoals[1]?.input_bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        arg_name: "support_refs",
        binding_kind: "support_ref",
        from_capability: "helix.theory.frontierVectorFieldTrace",
        required: true,
      }),
    ]));
    expect(subgoals[1]?.args_hint).toMatchObject({
      latex: "6*7",
      expression: "6*7",
    });
  });

  it("binds live synthetic-data reflection into a later calculator subgoal", () => {
    const compound = buildHelixCompoundCapabilityContract({
      turnId: "ask:tool-family-parity:live-synthetic-data-then-calculator",
      promptText:
        "Use live_synthetic_data_reflection for Helix Ask parity coverage, then run calculator with this exact expression: 8*4.",
    });
    const subgoals = compound?.subgoals ?? [];
    expect(compound?.schema).toBe("helix.compound_capability_contract.v1");
    expect(compound?.prompt_shape).toBe("compound_capability");
    expect(subgoals.map((subgoal) => subgoal.requested_capability)).toEqual([
      "helix_ask.reflect_live_synthetic_data",
      "scientific-calculator.solve_expression",
    ]);
    expect(subgoals[1]?.input_bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        arg_name: "support_refs",
        binding_kind: "support_ref",
        from_capability: "helix_ask.reflect_live_synthetic_data",
        required: true,
      }),
    ]));
    expect(subgoals[1]?.args_hint).toMatchObject({
      latex: "8*4",
      expression: "8*4",
    });
  });

  it("binds visual capture into a later calculator subgoal without widening calculator args", () => {
    const compound = buildHelixCompoundCapabilityContract({
      turnId: "ask:tool-family-parity:visual-capture-then-calculator",
      promptText:
        "Use visual capture for Helix Ask parity coverage, then run calculator with this exact expression: 5*9.",
    });
    const subgoals = compound?.subgoals ?? [];
    expect(compound?.schema).toBe("helix.compound_capability_contract.v1");
    expect(compound?.prompt_shape).toBe("compound_capability");
    expect(subgoals.map((subgoal) => subgoal.requested_capability)).toEqual([
      "image_lens.inspect",
      "scientific-calculator.solve_expression",
    ]);
    expect(subgoals[1]?.input_bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        arg_name: "support_refs",
        binding_kind: "support_ref",
        from_capability: "image_lens.inspect",
        required: true,
      }),
    ]));
    expect(subgoals[1]?.args_hint).toMatchObject({
      latex: "5*9",
      expression: "5*9",
    });
  });

  it("binds civilization scenario frames into civilization bounds reflection", () => {
    const compound = buildHelixCompoundCapabilityContract({
      turnId: "ask:tool-family-parity:civilization-frame-then-bounds",
      promptText:
        "Call helix_ask.build_civilization_scenario_frame for a long-range settlement scenario, then call helix_ask.reflect_civilization_bounds to reflect collaboration and falsification bounds.",
    });
    const subgoals = compound?.subgoals ?? [];
    expect(compound?.schema).toBe("helix.compound_capability_contract.v1");
    expect(compound?.prompt_shape).toBe("compound_capability");
    expect(subgoals.map((subgoal) => subgoal.requested_capability)).toEqual([
      "helix_ask.build_civilization_scenario_frame",
      "helix_ask.reflect_civilization_bounds",
    ]);
    expect(subgoals[1]?.input_bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        arg_name: "scenarioFrameRef",
        binding_kind: "source_ref",
        from_capability: "helix_ask.build_civilization_scenario_frame",
        required: true,
      }),
    ]));
    expect(subgoals[1]?.args_hint).toEqual(expect.objectContaining({
      scenarioFrameRef: "step:build_civilization_scenario_frame",
      source_ref: "step:build_civilization_scenario_frame",
      source_refs: ["step:build_civilization_scenario_frame"],
    }));
  });

  it("binds theory and ideology reflections into their explicit Moral bridge args", () => {
    const compound = buildHelixCompoundCapabilityContract({
      turnId: "ask:tool-family-parity:theory-ideology-bridge-bindings",
      promptText:
        "Call helix_ask.reflect_theory_context for Helix Ask parity, then call helix_ask.reflect_ideology_context for review policy, then call helix_ask.bridge_theory_ideology_context to bridge the two.",
    });
    const subgoals = compound?.subgoals ?? [];
    expect(compound?.schema).toBe("helix.compound_capability_contract.v1");
    expect(compound?.prompt_shape).toBe("compound_capability");
    expect(subgoals.map((subgoal) => subgoal.requested_capability)).toEqual([
      "helix_ask.reflect_theory_context",
      "helix_ask.reflect_ideology_context",
      "helix_ask.bridge_theory_ideology_context",
    ]);
    expect(subgoals[2]?.input_bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        arg_name: "theory_reflection_ref",
        binding_kind: "source_ref",
        from_capability: "helix_ask.reflect_theory_context",
        required: true,
      }),
      expect.objectContaining({
        arg_name: "ideology_reflection_ref",
        binding_kind: "source_ref",
        from_capability: "helix_ask.reflect_ideology_context",
        required: true,
      }),
    ]));
    expect(subgoals[2]?.args_hint).toEqual(expect.objectContaining({
      theory_reflection_ref: "step:reflect_theory_context",
      ideology_reflection_ref: "step:reflect_moral_graph_context",
    }));
  });

  it("keeps the objective-scoped tool family matrix exhaustive", () => {
    expect(objectiveFamilyCoverage.map((entry) => entry.label)).toEqual([
      ...objectiveScopeFamilyLabels,
    ]);
  });

  it("has representative compound live-probe requested/runtime coverage for every objective family", () => {
    const scenarioIds = COMPOUND_CAPABILITY_LIVE_SCENARIOS.map((scenario) => scenario.id);
    expect(new Set(scenarioIds).size).toBe(scenarioIds.length);
    for (const scenarioId of requiredAcceptanceCompoundScenarioIds) {
      expect(scenarioIds, `acceptance_scenario:${scenarioId}`).toContain(scenarioId);
    }
    const requiredAcceptanceScenarios = COMPOUND_CAPABILITY_LIVE_SCENARIOS.filter((scenario) =>
      requiredAcceptanceCompoundScenarioIds.includes(scenario.id as typeof requiredAcceptanceCompoundScenarioIds[number]),
    );
    const acceptanceRequestedCapabilities = new Set(
      requiredAcceptanceScenarios.flatMap((scenario) =>
        flattenExpectedCapabilities(scenario.expectedRequested),
      ),
    );
    const acceptanceRuntimeCapabilities = new Set(
      requiredAcceptanceScenarios.flatMap((scenario) =>
        flattenExpectedCapabilities(scenario.expectedRuntime),
      ),
    );

    for (const entry of objectiveFamilyCoverage) {
      for (const capability of entry.liveProbeCapabilities) {
        expect(liveProbeCapabilities.has(capability), `${entry.label}:${capability}`).toBe(true);
        expect(acceptanceRequestedCapabilities.has(capability), `acceptance:${entry.label}:${capability}`)
          .toBe(true);
      }
      const expectedRuntimeCapabilities = "liveProbeRuntimeCapabilities" in entry
        ? entry.liveProbeRuntimeCapabilities
        : entry.liveProbeCapabilities;
      for (const capability of expectedRuntimeCapabilities) {
        expect(liveProbeRuntimeCapabilities.has(capability), `${entry.label}:runtime:${capability}`).toBe(true);
        expect(acceptanceRuntimeCapabilities.has(capability), `acceptance:${entry.label}:runtime:${capability}`)
          .toBe(true);
      }
    }
  });

  it("maps compound live-probe coverage to the objective acceptance categories", () => {
    const scenariosById = new Map(COMPOUND_CAPABILITY_LIVE_SCENARIOS.map((scenario) => [scenario.id, scenario]));
    const mappedScenarioIds = new Set(
      objectiveAcceptanceCompoundScenarioCoverage.flatMap((entry) =>
        entry.scenarios.map((scenario) => scenario.id),
      ),
    );

    for (const scenarioId of requiredAcceptanceCompoundScenarioIds) {
      expect(mappedScenarioIds.has(scenarioId), `acceptance_category_map:${scenarioId}`).toBe(true);
    }

    for (const entry of objectiveAcceptanceCompoundScenarioCoverage) {
      for (const expectedScenario of entry.scenarios) {
        const scenario = scenariosById.get(expectedScenario.id);
        expect(scenario, `${entry.label}:${expectedScenario.id}`).toBeDefined();
        expect(requiredAcceptanceCompoundScenarioIds, `${entry.label}:required:${expectedScenario.id}`)
          .toContain(expectedScenario.id);
        if (!scenario) continue;

        const requestedCapabilities = new Set(flattenExpectedCapabilities(scenario.expectedRequested));
        for (const capability of flattenExpectedCapabilities(expectedScenario.requestedCapabilities)) {
          expect(requestedCapabilities.has(capability), `${entry.label}:${expectedScenario.id}:requested:${capability}`)
            .toBe(true);
        }

        const runtimeCapabilities = new Set(flattenExpectedCapabilities(scenario.expectedRuntime));
        for (const capability of flattenExpectedCapabilities(expectedScenario.runtimeCapabilities)) {
          expect(runtimeCapabilities.has(capability), `${entry.label}:${expectedScenario.id}:runtime:${capability}`)
            .toBe(true);
        }

        expect(
          expectedCapabilityMatches(scenario.expectedTerminalKind ?? null, expectedScenario.terminalKind),
          `${entry.label}:${expectedScenario.id}:terminal:${String(expectedScenario.terminalKind)}`,
        ).toBe(true);
      }
    }
  });

  it("backs every live-probe requested and runtime capability with an explicit contract", () => {
    for (const capability of liveProbeCapabilities) {
      expect(contractCapabilities.has(capability), `requested:${capability}`).toBe(true);
    }
    for (const capability of liveProbeRuntimeCapabilities) {
      expect(contractCapabilities.has(capability), `runtime:${capability}`).toBe(true);
    }
  });

  it("keeps live-probe scenarios structurally aligned with ordered subgoal expectations", () => {
    for (const scenario of COMPOUND_CAPABILITY_LIVE_SCENARIOS) {
      expect(scenario.expectedRequested.length, scenario.id).toBeGreaterThan(0);
      expect(scenario.expectedRuntime.length, scenario.id).toBe(scenario.expectedRequested.length);
      if (!scenario.acceptsObservationOnlyCompound) {
        expect(scenario.expectedTerminalKind, `${scenario.id}:expected_terminal_kind`).toBeTruthy();
      }
      expect(
        flattenExpectedCapabilities([scenario.expectedTerminalErrorCode ?? null]),
        `${scenario.id}:budget_exhaustion_not_expected_terminal_error`,
      ).not.toEqual(expect.arrayContaining([
        "agent_loop_budget_exhausted",
        "agent_tool_call_budget_exhausted",
      ]));
      for (const terminalKind of flattenExpectedCapabilities([scenario.expectedTerminalKind ?? null])) {
        expect(
          forbiddenCompoundScenarioTerminalKinds.has(terminalKind),
          `${scenario.id}:receipt_terminal_kind_forbidden:${terminalKind}`,
        ).toBe(false);
      }
      expect(
        scenario.expectedInputBindingFromCapabilities,
        `${scenario.id}:expected_input_binding_contract`,
      ).toBeDefined();
      expect(
        scenario.expectedInputBindingFromCapabilities?.length,
        scenario.id,
      ).toBe(scenario.expectedRequested.length);

      const compound = buildHelixCompoundCapabilityContract({
        turnId: `ask:tool-family-parity:live-probe:${scenario.id}`,
        promptText: scenario.prompt,
      });
      const itinerary = buildHelixCapabilityItinerary({
        turnId: `ask:tool-family-parity:live-probe:${scenario.id}`,
        promptText: scenario.prompt,
      });
      const subgoals = compound?.subgoals ?? [];
      if (scenario.acceptsObservationOnlyCompound) {
        expect(subgoals.length, `${scenario.id}:observation_only_contract_subgoals`).toBeGreaterThan(0);
        continue;
      }
      expect(subgoals, `${scenario.id}:contract_subgoals`).toHaveLength(scenario.expectedRequested.length);
      expect(compound?.requires_all_subgoals, `${scenario.id}:requires_all_subgoals`)
        .toBe(scenario.expectedRequested.length > 1);
      expect(
        itinerary.terminal_success_criteria.required_capabilities,
        `${scenario.id}:itinerary_required_capabilities`,
      ).toEqual(subgoals.map((subgoal) => subgoal.requested_capability));
      if (scenario.expectedRequested.length > 1) {
        expect(
          itinerary.terminal_success_criteria.compound_terminal_policy,
          `${scenario.id}:compound_terminal_policy`,
        ).toBe("synthesize_from_satisfied_subgoal_observations");
        expect(
          itinerary.terminal_success_criteria.forbidden_terminal_artifact_kinds,
          `${scenario.id}:tool_receipt_forbidden`,
        ).toContain("tool_receipt");
        for (const forbiddenKind of forbiddenCompoundScenarioTerminalKinds) {
          expect(
            itinerary.terminal_success_criteria.forbidden_terminal_artifact_kinds,
            `${scenario.id}:receipt_terminal_forbidden:${forbiddenKind}`,
          ).toContain(forbiddenKind);
          expect(
            itinerary.terminal_success_criteria.allowed_terminal_artifact_kinds,
            `${scenario.id}:receipt_terminal_not_allowed:${forbiddenKind}`,
          ).not.toContain(forbiddenKind);
        }
      }
      if (scenario.expectedTerminalErrorCode === undefined) {
        for (const terminalKind of flattenExpectedCapabilities([scenario.expectedTerminalKind ?? null])) {
          expect(
            itinerary.terminal_success_criteria.allowed_terminal_artifact_kinds,
            `${scenario.id}:allowed_terminal:${terminalKind}`,
          ).toContain(terminalKind);
        }
      }
      scenario.expectedRequested.forEach((expectedCapability, index) => {
        const subgoal = subgoals[index];
        const expectedRuntimeCapability = scenario.expectedRuntime[index] === null
          ? expectedCapability
          : scenario.expectedRuntime[index] ?? expectedCapability;
        expect(
          expectedCapabilityMatches(subgoal?.requested_capability, expectedCapability),
          `${scenario.id}:subgoal_${index + 1}:requested:${String(subgoal?.requested_capability ?? "")}`,
        ).toBe(true);
        expect(
          expectedCapabilityMatches(subgoal?.runtime_capability, expectedRuntimeCapability),
          `${scenario.id}:subgoal_${index + 1}:runtime:${String(subgoal?.runtime_capability ?? "")}`,
        ).toBe(true);
        expect(subgoal?.mandatory, `${scenario.id}:subgoal_${index + 1}:mandatory`).toBe(true);
        expect(subgoal?.required_observation_kinds.length, `${scenario.id}:subgoal_${index + 1}:observations`)
          .toBeGreaterThan(0);
      });
      if (scenario.expectedCalculatorExpression) {
        const calculatorIndex = scenario.expectedRequested.findIndex((expectedCapability) =>
          flattenExpectedCapabilities([expectedCapability]).includes("scientific-calculator.solve_expression"),
        );
        expect(calculatorIndex, `${scenario.id}:calculator_subgoal_index`).toBeGreaterThanOrEqual(0);
        const calculatorArgs = subgoals[calculatorIndex]?.args_hint as Record<string, unknown> | undefined;
        const expression =
          typeof calculatorArgs?.latex === "string"
            ? calculatorArgs.latex
            : typeof calculatorArgs?.expression === "string"
              ? calculatorArgs.expression
              : null;
        expect(expression, `${scenario.id}:calculator_expression`).toBe(scenario.expectedCalculatorExpression);
        expect(
          /workspace_os\.status|docs-viewer|repo-code|situation-room|then|plus|call|use|run/i.test(expression ?? ""),
          `${scenario.id}:calculator_expression_contains_prompt_prose`,
        ).toBe(false);
      }

      for (const capability of flattenExpectedCapabilities(scenario.expectedInputBindingFromCapabilities ?? [])) {
        expect(liveProbeCapabilities.has(capability), `${scenario.id}:input_binding:${capability}`).toBe(true);
      }
      scenario.expectedInputBindingFromCapabilities?.forEach((expectedBinding, index) => {
        if (expectedBinding === null) return;
        const priorRequestedCapabilities = new Set(
          flattenExpectedCapabilities(scenario.expectedRequested.slice(0, index)),
        );
        for (const capability of flattenExpectedCapabilities([expectedBinding])) {
          expect(
            priorRequestedCapabilities.has(capability),
            `${scenario.id}:subgoal_${index + 1}:input_binding:${capability}`,
          ).toBe(true);
          const subgoal = subgoals[index];
          const subgoalBindings = Array.isArray(subgoal?.input_bindings)
            ? subgoal.input_bindings
            : [];
          const expectedBindingShape = expectedBindingShapeForConsumer(
            subgoal?.requested_capability,
            subgoalBindings.length,
            capability,
          );
          const matchingBindings = subgoalBindings.filter((binding) => binding.from_capability === capability);
          expect(
            matchingBindings.length > 0,
            `${scenario.id}:subgoal_${index + 1}:contract_input_binding:${capability}`,
          ).toBe(true);
          for (const binding of matchingBindings) {
            const sourceSubgoal = subgoals
              .slice(0, index)
              .find((candidate) => candidate.requested_capability === capability);
            expect(
              sourceSubgoal,
              `${scenario.id}:subgoal_${index + 1}:binding_source_subgoal:${capability}`,
            ).toBeTruthy();
            expect(
              binding.from_subgoal_id,
              `${scenario.id}:subgoal_${index + 1}:binding_from_subgoal_id:${capability}`,
            ).toBe(sourceSubgoal?.subgoal_id);
            expect(
              sortedStrings(binding.required_observation_kinds ?? []),
              `${scenario.id}:subgoal_${index + 1}:binding_required_observations:${capability}`,
            ).toEqual(sortedStrings(sourceSubgoal?.required_observation_kinds ?? []));
            expect(binding.required, `${scenario.id}:subgoal_${index + 1}:binding_required:${capability}`)
              .toBe(true);
            expect(binding.status, `${scenario.id}:subgoal_${index + 1}:binding_status:${capability}`)
              .toBe("pending");
            expect(binding.arg_name, `${scenario.id}:subgoal_${index + 1}:binding_arg_name:${capability}`)
              .toBe(expectedBindingShape.argName);
            expect(binding.binding_kind, `${scenario.id}:subgoal_${index + 1}:binding_kind:${capability}`)
              .toBe(expectedBindingShape.bindingKind);
          }
        }
      });
      expect(
        scenario.expectedSubgoalSatisfaction?.length ?? scenario.expectedRequested.length,
        scenario.id,
      ).toBe(scenario.expectedRequested.length);
      expect(
        scenario.expectedRailStatus?.length ?? scenario.expectedRequested.length,
        scenario.id,
      ).toBe(scenario.expectedRequested.length);
      expect(
        scenario.expectedFirstBrokenRail?.length ?? scenario.expectedRequested.length,
        scenario.id,
      ).toBe(scenario.expectedRequested.length);
      expect(
        scenario.expectedRailFailureCode?.length ?? scenario.expectedRequested.length,
        scenario.id,
      ).toBe(scenario.expectedRequested.length);
      expect(
        scenario.expectedRepairTarget?.length ?? scenario.expectedRequested.length,
        scenario.id,
      ).toBe(scenario.expectedRequested.length);
    }
  });

  it("keeps compound synthesis support grounded in observations instead of receipt-only refs", () => {
    const synthesisSource = readRepoSource("server/services/helix-ask/compound-capability-synthesis.ts");
    const authoritySource = readRepoSource("server/services/helix-ask/terminal-authority-single-writer.ts");
    const artifactFallbackStart = synthesisSource.indexOf("const supportRefsFromArtifacts =");
    const artifactFallbackEnd = synthesisSource.indexOf("const terminalKindsFromSubgoals =", artifactFallbackStart);
    const artifactFallbackSource =
      artifactFallbackStart >= 0 && artifactFallbackEnd > artifactFallbackStart
        ? synthesisSource.slice(artifactFallbackStart, artifactFallbackEnd)
        : "";

    expect(synthesisSource).toEqual(expect.stringContaining("readString(entry.observation_ref)"));
    expect(synthesisSource).toEqual(expect.stringContaining("ledgerEntryHasSatisfiedObservation"));
    expect(synthesisSource).toEqual(expect.stringContaining("...readArray(entry.support_refs).map(readString)"));
    expect(synthesisSource).toEqual(expect.stringContaining("...readArray(entry.evidence_refs).map(readString)"));
    expect(synthesisSource).toEqual(expect.stringContaining("...readArray(entry.coverage_refs).map(readString)"));
    expect(synthesisSource).not.toEqual(expect.stringContaining("...readArray(entry.receipt_refs).map(readString)"));
    expect(synthesisSource).not.toEqual(expect.stringContaining("...readArray(entry.receipt_ids).map(readString)"));
    expect(artifactFallbackSource).toEqual(expect.stringContaining("/(?:^|_)(?:receipt|receipts)$/i.test(kind)"));
    expect(authoritySource).toEqual(expect.stringContaining("!compoundTerminalSynthesisActive"));
    expect(authoritySource).toEqual(expect.stringContaining("compoundReceiptTerminalBlocked ? null : rawSelectedReceiptTerminal"));
    expect(authoritySource).toEqual(expect.stringContaining("compoundSubgoalHasSatisfiedObservation"));
    expect(authoritySource).toEqual(expect.stringContaining(".filter(compoundSubgoalHasSatisfiedObservation)"));
  });

  it("keeps compound subgoal support refs from smuggling receipt-only side refs", () => {
    const executionSource = readRepoSource("server/services/helix-ask/capability-itinerary-execution.ts");
    const start = executionSource.indexOf("const artifactSupportRefs =");
    const end = executionSource.indexOf("const artifactCompletedRuntimeObservation =", start);
    const supportRefsSource = start >= 0 && end > start ? executionSource.slice(start, end) : "";
    expect(supportRefsSource).toEqual(expect.stringContaining("artifactId(artifact)"));
    expect(supportRefsSource).toEqual(expect.stringContaining("payload?.observation_refs"));
    expect(supportRefsSource).not.toEqual(expect.stringContaining("payload?.receipt_id"));
    expect(supportRefsSource).not.toEqual(expect.stringContaining("observation?.receipt_id"));
    expect(supportRefsSource).not.toEqual(expect.stringContaining("result?.receipt_id"));
    expect(supportRefsSource).not.toEqual(expect.stringContaining("payload?.receipt_refs"));
    expect(supportRefsSource).not.toEqual(expect.stringContaining("payload?.tool_receipt_ids"));
  });

  it("keeps compound draft support coverage from treating receipt side refs as observation proof", () => {
    const authoritySource = readRepoSource("server/services/helix-ask/terminal-authority-single-writer.ts");
    const start = authoritySource.indexOf("const collectRefsFromRecord =");
    const end = authoritySource.indexOf("const collectExplicitFinalAnswerDraftSupportRefs =", start);
    const collectRefsSource = start >= 0 && end > start ? authoritySource.slice(start, end) : "";
    expect(collectRefsSource).toEqual(expect.stringContaining("readString(record.observation_ref)"));
    expect(collectRefsSource).toEqual(expect.stringContaining("readString(record.source_observation_ref)"));
    expect(collectRefsSource).toEqual(expect.stringContaining("...readArray(record.support_refs).map(readString)"));
    expect(collectRefsSource).toEqual(expect.stringContaining("...readArray(record.evidence_refs).map(readString)"));
    expect(collectRefsSource).toEqual(expect.stringContaining("...readArray(record.observation_refs).map(readString)"));
    expect(collectRefsSource).not.toEqual(expect.stringContaining("record.receipt_id"));
    expect(collectRefsSource).not.toEqual(expect.stringContaining("record.receipt_ids"));
    expect(collectRefsSource).not.toEqual(expect.stringContaining("record.receipt_refs"));
  });
});
