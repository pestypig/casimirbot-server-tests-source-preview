import { describe, expect, it } from "vitest";
import type { HelixToolCallAdmissionDecision, HelixToolCallAdmissionFamily } from "@shared/helix-tool-call-admission";
import { buildHelixCapabilityItinerary } from "../services/helix-ask/capability-itinerary";
import { buildHelixCapabilityItineraryExecutionState } from "../services/helix-ask/capability-itinerary-execution";
import { buildHelixCompoundCapabilityContract } from "../services/helix-ask/compound-capability-contract";
import { applyCompoundTerminalPolicy, readCompoundTerminalPolicy } from "../services/helix-ask/compound-terminal-policy";
import { resolveCompoundCapabilitySynthesisReadiness } from "../services/helix-ask/compound-capability-synthesis";
import { explicitCapabilityContractsForTests } from "../services/helix-ask/explicit-capability-contract";
import { TOOL_FAMILY_CONTRACTS } from "../services/helix-ask/tool-family-contract";
import { buildToolCallAdmissionDecision } from "../services/helix-ask/tool-call-admission";

type ExplicitContract = typeof explicitCapabilityContractsForTests[number];

const runtimeCapabilityFor = (contract: ExplicitContract): string =>
  contract.runtime_capability && contract.runtime_capability !== contract.capability
    ? contract.runtime_capability
    : contract.capability;

const promptFor = (contract: ExplicitContract): string => {
  if (contract.capability === "scientific-calculator.solve_expression") {
    return "Call scientific-calculator.solve_expression with this exact expression: 6*7.";
  }
  if (
    contract.capability === "scientific-calculator.solve_with_steps" ||
    contract.capability === "scientific-calculator.solve"
  ) {
    return `Call ${contract.capability} with this exact expression: 6*7.`;
  }
  if (contract.capability === "scientific-calculator.start_equation_live_source") {
    return "Call scientific-calculator.start_equation_live_source with this exact expression: 6*7.";
  }
  if (contract.capability === "docs-viewer.locate_in_doc") {
    return "Call docs-viewer.locate_in_doc to locate the rule of thumb in docs/helix-ask-codex-loop-discipline.md.";
  }
  if (contract.capability === "docs-viewer.search_docs") {
    return "Call docs-viewer.search_docs for query: terminal authority.";
  }
  if (contract.capability === "docs-viewer.open_doc_by_path") {
    return "Call docs-viewer.open_doc_by_path for path: docs/helix-ask-codex-loop-discipline.md.";
  }
  if (contract.capability === "docs-viewer.doc_equation_context") {
    return "Call docs-viewer.doc_equation_context to locate equation context for query: warp bubble energy in docs/helix-ask-codex-loop-discipline.md.";
  }
  if (contract.capability === "repo-code.search_concept") {
    return "Call repo-code.search_concept to find terminal authority enforcement.";
  }
  if (contract.capability === "workspace-directory.resolve") {
    return "Call workspace-directory.resolve for docs/helix-ask-codex-loop-discipline.md.";
  }
  if (contract.capability === "internet_search.web_research") {
    return "Call internet_search.web_research for OpenAI Codex documentation.";
  }
  if (contract.capability === "scholarly-research.lookup_papers") {
    return "Call scholarly-research.lookup_papers for Alcubierre metric energy estimates.";
  }
  if (contract.capability === "scholarly-research.fetch_full_text") {
    return "Call scholarly-research.fetch_full_text paper_result_id=arxiv:warp-1994.";
  }
  if (contract.capability === "helix.theory.frontierVectorFieldTrace") {
    return "Call helix.theory.frontierVectorFieldTrace for Alcubierre metric field gradients.";
  }
  if (contract.capability === "image_lens.inspect") {
    return "Call image_lens.inspect to inspect the current visual frame.";
  }
  if (contract.capability === "workstation-notes.append_to_note") {
    return "Call workstation-notes.append_to_note with text: record this Helix Ask parity note.";
  }
  if (contract.capability === "workstation-notes.create_note") {
    return "Call workstation-notes.create_note with title: Helix Ask parity note.";
  }
  return `Call ${contract.capability}.`;
};

const promptForPair = (first: ExplicitContract, second: ExplicitContract): string =>
  `${promptFor(first)} Then ${promptFor(second).replace(/^Call\b/, "call")}`;

const promptForChain = (contracts: ExplicitContract[]): string =>
  contracts
    .map((contract, index) =>
      index === 0
        ? promptFor(contract)
        : `Then ${promptFor(contract).replace(/^Call\b/, "call")}`
    )
    .join(" ");

const contractByCapability = (capability: string): ExplicitContract => {
  const contract = explicitCapabilityContractsForTests.find((entry) => entry.capability === capability);
  if (!contract) throw new Error(`missing_explicit_capability_contract:${capability}`);
  return contract;
};

const representativesByCapabilityFamily = (): ExplicitContract[] => {
  const byFamily = new Map<string, ExplicitContract>();
  for (const contract of explicitCapabilityContractsForTests) {
    if (!byFamily.has(contract.capability_family)) byFamily.set(contract.capability_family, contract);
  }
  return Array.from(byFamily.values());
};

const requiresDocEvidenceSynthesis = (contracts: ExplicitContract[]): boolean =>
  contracts.some((contract) =>
    /docs-viewer\.(?:locate_in_doc|summarize_doc|search_docs)/i.test(contract.capability)
  );

const explicitCapabilityNames = (): Set<string> => new Set(
  explicitCapabilityContractsForTests.flatMap((contract) => [
    contract.capability,
    contract.runtime_capability ?? "",
    ...(contract.aliases ?? []),
  ].filter(Boolean)),
);

const expectedTerminalKindsByFamily: Record<string, string[]> = {
  capability_catalog: ["capability_help_summary"],
  calculator: ["workstation_tool_evaluation"],
  workspace_diagnostic: ["model_synthesized_answer"],
  docs_viewer: ["doc_open_receipt", "doc_location_matches", "doc_summary", "doc_equation_context", "model_synthesized_answer"],
  repo_code: ["repo_code_evidence_answer"],
  workspace_directory: ["workspace_directory_resolution"],
  internet_search: ["internet_search_answer"],
  scholarly_research: ["scholarly_research_answer"],
  live_source_mail: ["model_synthesized_answer"],
  live_source_decision: ["model_synthesized_answer"],
  voice_delivery: ["model_synthesized_answer"],
  live_environment: ["direct_answer_text", "workstation_tool_evaluation", "model_synthesized_answer"],
  context_reflection: ["model_synthesized_answer"],
  theory_locator: ["theory_context_reflection_answer"],
  moral_graph_reflection: ["model_synthesized_answer"],
  civilization_bounds: ["model_synthesized_answer"],
  visual_capture: ["situation_context_pack", "image_lens_observation_report"],
  workstation: ["model_synthesized_answer", "workstation_tool_evaluation", "note_update_receipt"],
};

const argValuePresent = (value: unknown): boolean => {
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return false;
};

const requiredArgAliasesFor = (contract: ExplicitContract, requiredArg: string): string[] => {
  const names = [requiredArg];
  const runtimeCapability = runtimeCapabilityFor(contract);
  if (requiredArg === "latex" && runtimeCapability === "scientific-calculator.solve_expression") {
    names.push("expression", "equation");
  }
  if (requiredArg === "query") {
    if (runtimeCapability === "repo-code.search_concept") names.push("concept");
    if (runtimeCapability === "workspace-directory.resolve") names.push("uri", "path", "target");
    if (runtimeCapability === "internet-search.search_web" || runtimeCapability === "internet_search.web_research") {
      names.push("question", "prompt", "topic", "search_query");
    }
    if (runtimeCapability === "scholarly-research.lookup_papers") {
      names.push("doi", "arxiv_id", "arxivId", "title", "journal", "reference", "citation");
    }
  }
  if (requiredArg === "paper_result_or_source" && runtimeCapability === "scholarly-research.fetch_full_text") {
    names.push("paper_result_id", "paper_id", "result_id", "doi", "arxiv_id", "arxivId", "source_url", "pdf_url", "full_text_url", "url");
  }
  if (requiredArg === "text" && runtimeCapability === "workstation-notes.append_to_note") {
    names.push("body", "content");
  }
  return names;
};

const admissionFor = (turnId: string, contracts: ExplicitContract[]): HelixToolCallAdmissionDecision => ({
  schema: "helix.tool_call_admission_decision.v1",
  turn_id: turnId,
  source_target: "runtime_evidence",
  required: true,
  admitted_tool_families: Array.from(new Set(
    contracts.flatMap((contract) => contract.admission_families),
  )) as HelixToolCallAdmissionFamily[],
  forbidden_terminal_artifact_kinds: [],
  forbidden_routes: [],
  reason: "test_all_explicit_capability_contract_families",
  assistant_answer: false,
  raw_content_included: false,
});

const sanitize = (value: string): string => value.replace(/[^A-Za-z0-9:_-]+/g, "_");

const availableCapabilities = (contracts: ExplicitContract[]) => ({
  schema: "helix.available_capabilities.v1",
  turn_id: "ask:compound-family-matrix",
  manifest_role: "model_visible_tool_menu",
  tool_manifest_version: "helix.ask.capability_manifest.v1",
  user_goal_summary: "test",
  canonical_goal_kind: "compound_capability",
  model_visible_capability_keys: contracts.map(runtimeCapabilityFor),
  recommended_capability_key: runtimeCapabilityFor(contracts[0]),
  classifier_hints: [],
  capabilities: contracts.map((contract) => {
    const key = runtimeCapabilityFor(contract);
    return {
      capability_key: key,
      label: key,
      lane: "tool",
      requires_action: true,
      expected_artifacts: contract.required_observation_kinds,
      goal_fit: "primary",
      reason: "test",
      model_visible_name: key,
      model_visible_description: key,
      availability: "available",
    };
  }),
  assistant_answer: false,
  raw_content_included: false,
});

const schemaForKind = (kind: string): string =>
  kind.includes("/") ? kind : `helix.${kind}.v1`;

const familyObservationKind = (family: string): string | null => {
  if (family === "workstation_action") return "workstation_tool_evaluation";
  if (family === "live_environment") return "live_environment_tool_observation";
  if (family === "live_source_mail") return "stage_play_processed_mail_packet";
  if (family === "live_source_decision") return "stage_play_live_source_mail_decision";
  if (family === "voice_delivery") return "voice_receipt";
  if (family === "runtime_evidence") return "capability_registry";
  if (family === "situation_run") return "situation_context_pack";
  if (family === "visual_capture") return "situation_context_pack";
  if (family === "moral_graph_reflection") return "helix_moral_graph_reflection_tool_result";
  if (family === "civilization_bounds") return "helix_civilization_bounds_tool_result";
  if (family === "workstation") return "note_action_receipt";
  return null;
};

const completedArtifactsForItinerary = (
  turnId: string,
  itinerary: ReturnType<typeof buildHelixCapabilityItinerary>,
): Array<Record<string, unknown>> => {
  const subgoals = (itinerary.compound_capability_contract?.subgoals ?? []) as Array<Record<string, unknown>>;
  const artifacts = subgoals.flatMap((subgoal, index) => {
    const requested = String(subgoal.requested_capability ?? "");
    const runtime = String(subgoal.runtime_capability ?? requested);
    const subgoalId = String(subgoal.subgoal_id ?? `${turnId}:subgoal:${index + 1}`);
    const requiredKinds = Array.isArray(subgoal.required_observation_kinds)
      ? subgoal.required_observation_kinds.map(String)
      : [];
    const producedAffordanceKinds = Array.isArray(subgoal.produced_affordance_kinds)
      ? subgoal.produced_affordance_kinds.map(String)
      : [];
    const consumedAffordanceKinds = Array.isArray(subgoal.consumed_affordance_kinds)
      ? subgoal.consumed_affordance_kinds.map(String)
      : [];
    const observationKind = requiredKinds[0] ?? "runtime_tool_observation";
    const artifactBase = `${turnId}:${sanitize(runtime)}:${index + 1}`;
    return [
      {
        artifact_id: `${artifactBase}:runtime_tool_call`,
        kind: "runtime_tool_call",
        payload: {
          capability_key: runtime,
          compound_subgoal_id: subgoalId,
          args: subgoal.args_hint ?? {},
        },
      },
      {
        artifact_id: `${artifactBase}:runtime_tool_observation`,
        kind: "runtime_tool_observation",
        payload: {
          capability_key: runtime,
          compound_subgoal_id: subgoalId,
          status: "completed",
          produced_affordance_kinds: producedAffordanceKinds,
          consumed_affordance_kinds: consumedAffordanceKinds,
        },
      },
      {
        artifact_id: `${artifactBase}:declared_observation`,
        kind: observationKind,
        payload: {
          schema: schemaForKind(observationKind),
          capability_key: runtime,
          compound_subgoal_id: subgoalId,
          status: "completed",
          produced_affordance_kinds: producedAffordanceKinds,
          consumed_affordance_kinds: consumedAffordanceKinds,
          ...(requested === "docs-viewer.locate_in_doc"
            ? {
                status: "located",
                match_count: 1,
                matches: [
                  {
                    ref: `${artifactBase}:declared_observation`,
                    path: "docs/helix-ask-turn-solver-spine.md",
                    start_line: 30,
                    end_line: 34,
                    snippet: "Only the completed solver path may answer.",
                  },
                ],
              }
            : {}),
        },
      },
    ];
  });

  const familyArtifacts = itinerary.planned_steps
    .map((step, index) => {
      const kind = familyObservationKind(step.tool_family);
      if (!kind) return null;
      const runtime = step.runtime_capability ?? step.capability_hint ?? step.requested_capability ?? step.tool_family;
      return {
        artifact_id: `${turnId}:family:${sanitize(step.tool_family)}:${index + 1}`,
        kind,
        payload: {
          schema: schemaForKind(kind),
          capability_key: runtime,
          compound_subgoal_id: step.compound_subgoal_id ?? null,
          status: "completed",
          authority: "agent_runtime_loop",
          supports_goal: true,
        },
      };
    })
    .filter((artifact): artifact is Record<string, unknown> => Boolean(artifact));

  return [...artifacts, ...familyArtifacts];
};

const assertPairContract = (first: ExplicitContract, second: ExplicitContract): void => {
  const turnId = `ask:compound-family:${first.capability}:then:${second.capability}`
    .replace(/[^A-Za-z0-9:_-]+/g, "_");
  const itinerary = buildHelixCapabilityItinerary({
    turnId,
    promptText: promptForPair(first, second),
    toolCallAdmissionDecision: admissionFor(turnId, [first, second]),
    availableCapabilities: availableCapabilities([first, second]),
  });

  const subgoals = (itinerary.compound_capability_contract?.subgoals ?? []) as Array<Record<string, unknown>>;
  expect(
    itinerary.prompt_shape,
    `${first.capability}->${second.capability}:${promptForPair(first, second)}`,
  ).toBe("compound_tool");
  expect(subgoals.map((subgoal) => subgoal.requested_capability)).toEqual([
    first.capability,
    second.capability,
  ]);
  expect(subgoals.map((subgoal) => subgoal.runtime_capability)).toEqual([
    runtimeCapabilityFor(first),
    runtimeCapabilityFor(second),
  ]);
  expect(itinerary.terminal_success_criteria.required_capabilities).toEqual([
    first.capability,
    second.capability,
  ]);
  expect(itinerary.terminal_success_criteria.requires_post_observation_synthesis).toBe(true);
  expect(itinerary.terminal_success_criteria.allowed_terminal_artifact_kinds).toEqual(
    expect.arrayContaining([
      "final_answer_draft",
      "compound_evidence_synthesis_answer",
      "model_synthesized_answer",
    ]),
  );
  for (const standaloneTerminalKind of [first.required_terminal_kind, second.required_terminal_kind]) {
    if (
      standaloneTerminalKind !== "final_answer_draft" &&
      standaloneTerminalKind !== "model_synthesized_answer" &&
      standaloneTerminalKind !== "doc_evidence_synthesis_answer"
    ) {
      expect(itinerary.terminal_success_criteria.allowed_terminal_artifact_kinds)
        .not.toContain(standaloneTerminalKind);
    }
  }
  expect(itinerary.terminal_success_criteria.forbidden_terminal_artifact_kinds).toEqual(
    expect.arrayContaining(["tool_receipt"]),
  );
  expect(itinerary.terminal_success_criteria.compound_terminal_policy).toBe(
    "synthesize_from_satisfied_subgoal_observations",
  );
  if (requiresDocEvidenceSynthesis([first, second])) {
    expect(itinerary.terminal_success_criteria.allowed_terminal_artifact_kinds)
      .toContain("doc_evidence_synthesis_answer");
  }
};

const assertCompletedNamedScenario = (
  scenarioName: string,
  capabilities: string[],
  expectedSynthesisKind?: "compound_evidence_synthesis_answer" | "doc_evidence_synthesis_answer" | "model_synthesized_answer",
): void => {
  const contracts = capabilities.map(contractByCapability);
  const turnId = `ask:named-compound:${scenarioName}`.replace(/[^A-Za-z0-9:_-]+/g, "_");
  const itinerary = buildHelixCapabilityItinerary({
    turnId,
    promptText: promptForChain(contracts),
    toolCallAdmissionDecision: admissionFor(turnId, contracts),
    availableCapabilities: availableCapabilities(contracts),
  });
  const subgoals = (itinerary.compound_capability_contract?.subgoals ?? []) as Array<Record<string, unknown>>;

  expect(itinerary.prompt_shape, scenarioName).toBe("compound_tool");
  expect(subgoals.map((subgoal) => subgoal.requested_capability), scenarioName).toEqual(capabilities);
  expect(subgoals.map((subgoal) => subgoal.runtime_capability), scenarioName).toEqual(
    contracts.map(runtimeCapabilityFor),
  );
  expect(itinerary.terminal_success_criteria.required_capabilities, scenarioName).toEqual(capabilities);
  expect(itinerary.terminal_success_criteria.forbidden_terminal_artifact_kinds, scenarioName)
    .toEqual(expect.arrayContaining(["tool_receipt"]));

  const artifacts = completedArtifactsForItinerary(turnId, itinerary);
  const state = buildHelixCapabilityItineraryExecutionState({
    capabilityItinerary: itinerary,
    artifacts,
  });
  const readiness = resolveCompoundCapabilitySynthesisReadiness({
    payload: {
      capability_itinerary: {
        ...itinerary,
        execution_state: state,
      },
      capability_itinerary_execution_state: state,
    },
    artifacts,
  });

  expect(state.complete, scenarioName).toBe(true);
  expect(state.missing_required_capabilities, scenarioName).toEqual([]);
  expect(state.compound_subgoal_ledger.map((entry) => entry.requested_capability), scenarioName).toEqual(capabilities);
  expect(state.compound_subgoal_ledger.map((entry) => entry.satisfaction), scenarioName)
    .toEqual(capabilities.map(() => "satisfied"));
  expect(state.compound_subgoal_ledger.map((entry) => entry.rail_status), scenarioName)
    .toEqual(capabilities.map(() => "complete"));
  expect(readiness.complete, scenarioName).toBe(true);
  expect(readiness.synthesis_required, scenarioName).toBe(true);
  expect(readiness.support_refs.length, scenarioName).toBeGreaterThanOrEqual(capabilities.length);
  if (expectedSynthesisKind) {
    expect(readiness.synthesis_terminal_kind, scenarioName).toBe(expectedSynthesisKind);
  }
};

const assertCompletedSingleCapabilityRail = (contract: ExplicitContract): void => {
  const turnId = `ask:single-family:${contract.capability_family}:${contract.capability}`
    .replace(/[^A-Za-z0-9:_-]+/g, "_");
  const itinerary = buildHelixCapabilityItinerary({
    turnId,
    promptText: promptFor(contract),
    toolCallAdmissionDecision: admissionFor(turnId, [contract]),
    availableCapabilities: availableCapabilities([contract]),
  });
  const artifacts = completedArtifactsForItinerary(turnId, itinerary);
  const state = buildHelixCapabilityItineraryExecutionState({
    capabilityItinerary: itinerary,
    artifacts,
  });
  const ledgerEntry = state.compound_subgoal_ledger.find((entry) =>
    entry.requested_capability === contract.capability
  );

  expect(itinerary.prompt_shape, contract.capability).toBe("single_tool");
  expect(state.complete, contract.capability).toBe(true);
  expect(state.missing_required_capabilities, contract.capability).toEqual([]);
  expect(ledgerEntry, contract.capability).toMatchObject({
    requested_capability: contract.capability,
    selected_capability: runtimeCapabilityFor(contract),
    executed_capability: runtimeCapabilityFor(contract),
    required_observation_kinds: contract.required_observation_kinds,
    required_terminal_kind: contract.required_terminal_kind,
    allowed_substitutions: contract.allowed_substitutions,
    satisfaction: "satisfied",
    rail_status: "complete",
  });
  expect(ledgerEntry?.observation_kind, contract.capability).toBeTruthy();
  expect(ledgerEntry?.observation_ref, contract.capability).toBeTruthy();
};

describe("Helix Ask compound capability family matrix", () => {
  it("accepts capability-bound declared observations as execution proof without a runtime wrapper", () => {
    const contract = contractByCapability("workspace_os.status");
    const turnId = "ask:compound-family:workspace-status-declared-observation";
    const itinerary = buildHelixCapabilityItinerary({
      turnId,
      promptText: promptFor(contract),
      toolCallAdmissionDecision: admissionFor(turnId, [contract]),
      availableCapabilities: availableCapabilities([contract]),
    });
    const subgoal = ((itinerary.compound_capability_contract?.subgoals ?? []) as Array<Record<string, unknown>>)
      .find((entry) => entry.requested_capability === contract.capability);
    const runtime = runtimeCapabilityFor(contract);
    const artifacts = [
      {
        artifact_id: `${turnId}:workspace_status:runtime_tool_call`,
        kind: "runtime_tool_call",
        payload: {
          capability_key: runtime,
          compound_subgoal_id: subgoal?.subgoal_id,
          args: subgoal?.args_hint ?? {},
        },
      },
      {
        artifact_id: `${turnId}:workspace_status:declared_observation`,
        kind: "workspace_os_status_observation",
        payload: {
          schema: "helix.workspace_os_status_observation.v1",
          capability_key: runtime,
          compound_subgoal_id: subgoal?.subgoal_id,
          status: "completed",
        },
      },
    ];
    const state = buildHelixCapabilityItineraryExecutionState({
      capabilityItinerary: itinerary,
      artifacts,
    });
    const ledgerEntry = state.compound_subgoal_ledger.find((entry) =>
      entry.requested_capability === contract.capability
    );

    expect(state.complete).toBe(true);
    expect(ledgerEntry).toMatchObject({
      requested_capability: "workspace_os.status",
      selected_capability: "workspace_os.status",
      executed_capability: "workspace_os.status",
      observation_kind: "workspace_os_status_observation",
      observation_provenance: "compound_subgoal_id",
      satisfaction: "satisfied",
      rail_status: "complete",
    });
  });

  it("does not treat unbound lookalike observations as explicit docs execution proof", () => {
    const contract = contractByCapability("docs-viewer.locate_in_doc");
    const turnId = "ask:compound-family:docs-unbound-lookalike-observation";
    const itinerary = buildHelixCapabilityItinerary({
      turnId,
      promptText: promptFor(contract),
      toolCallAdmissionDecision: admissionFor(turnId, [contract]),
      availableCapabilities: availableCapabilities([contract]),
    });
    const artifacts = [
      {
        artifact_id: `${turnId}:docs:runtime_tool_call`,
        kind: "runtime_tool_call",
        payload: {
          capability_key: runtimeCapabilityFor(contract),
          args: { query: "rule of thumb" },
        },
      },
      {
        artifact_id: `${turnId}:docs:model_location_guess`,
        kind: "doc_location_matches",
        payload: {
          schema: "helix.doc_location_matches.v1",
          status: "completed",
        },
      },
    ];
    const state = buildHelixCapabilityItineraryExecutionState({
      capabilityItinerary: itinerary,
      artifacts,
    });
    const ledgerEntry = state.compound_subgoal_ledger.find((entry) =>
      entry.requested_capability === contract.capability
    );

    expect(state.complete).toBe(false);
    expect(state.missing_required_capabilities).toContain("docs-viewer.locate_in_doc");
    expect(ledgerEntry).toMatchObject({
      requested_capability: "docs-viewer.locate_in_doc",
      selected_capability: "docs.search",
      executed_capability: null,
      observation_kind: null,
      observation_ref: null,
      observation_provenance: null,
      satisfaction: "failed",
      rail_status: "fail_closed",
    });
  });

  it("inventories the current explicit capability surface by family", () => {
    const families = Array.from(new Set(explicitCapabilityContractsForTests.map((contract) => contract.capability_family)));

    expect(explicitCapabilityContractsForTests.length).toBeGreaterThanOrEqual(46);
    expect(families).toEqual(expect.arrayContaining([
      "capability_catalog",
      "calculator",
      "workspace_diagnostic",
      "docs_viewer",
      "repo_code",
      "workspace_directory",
      "internet_search",
      "scholarly_research",
      "live_source_mail",
      "live_source_decision",
      "voice_delivery",
      "live_environment",
      "context_reflection",
      "theory_locator",
      "moral_graph_reflection",
      "civilization_bounds",
      "visual_capture",
      "workstation",
    ]));
  });

  it("keeps explicit capability contracts aligned with concrete tool-family contracts", () => {
    const names = explicitCapabilityNames();
    const missing = TOOL_FAMILY_CONTRACTS
      .filter((contract) => !contract.toolName.startsWith("family:"))
      .map((contract) => contract.toolName)
      .filter((toolName) => !names.has(toolName))
      .sort();

    expect(missing).toEqual([]);
  });

  it("defaults active compound terminal policy to synthesis terminals and receipt forbiddance", () => {
    const payload = {
      compound_capability_contract: {
        subgoals: [
          {
            requested_capability: "docs-viewer.locate_in_doc",
            runtime_capability: "docs-viewer.locate_in_doc",
            capability_family: "docs_viewer",
          },
          {
            requested_capability: "scientific-calculator.solve_expression",
            runtime_capability: "scientific-calculator.solve_expression",
            capability_family: "calculator",
          },
        ],
      },
    };
    const policy = readCompoundTerminalPolicy(payload);
    const applied = applyCompoundTerminalPolicy(payload, {
      allowed: ["doc_summary", "calculator_receipt"],
      forbidden: ["custom_route_forbidden_terminal"],
      requiredTerminalKind: "doc_summary",
    });

    expect(policy.active).toBe(true);
    expect(policy.source).toBe("compound_capability_contract_or_execution_state");
    expect(policy.allowed_terminal_artifact_kinds).toEqual(expect.arrayContaining([
      "final_answer_draft",
      "compound_evidence_synthesis_answer",
      "model_synthesized_answer",
      "doc_evidence_synthesis_answer",
    ]));
    expect(policy.required_terminal_kind).toBe("doc_evidence_synthesis_answer");
    expect(applied.allowed).toEqual(policy.allowed_terminal_artifact_kinds);
    expect(applied.allowed).not.toEqual(expect.arrayContaining(["doc_summary", "calculator_receipt"]));
    expect(applied.forbidden).toEqual(expect.arrayContaining([
      "tool_receipt",
      "calculator_receipt",
      "doc_open_receipt",
      "workspace_action_receipt",
      "custom_route_forbidden_terminal",
    ]));
  });

  it("keeps a multi-step scholarly pipeline on the route-authorized scholarly answer product", () => {
    const payload = {
      canonical_goal_frame: {
        goal_kind: "agent_provider_gateway_turn",
        required_terminal_kind: "scholarly_research_answer",
      },
      route_product_contract: {
        required_terminal_kind: "scholarly_research_answer",
        allowed_terminal_artifact_kinds: ["scholarly_research_answer", "typed_failure"],
      },
      compound_capability_contract: {
        requires_all_subgoals: true,
        subgoals: [
          {
            requested_capability: "scholarly-research.lookup_papers",
            runtime_capability: "scholarly-research.lookup_papers",
          },
          {
            requested_capability: "scholarly-research.fetch_full_text",
            runtime_capability: "scholarly-research.fetch_full_text",
          },
        ],
      },
      compound_capability_synthesis_readiness: {
        applies: true,
        complete: false,
        required_terminal_kind: "compound_evidence_synthesis_answer",
        subgoal_terminal_kinds: ["scholarly_research_answer"],
        terminal_contribution_kinds: ["scholarly_research_answer"],
      },
    };

    const policy = readCompoundTerminalPolicy(payload);
    const applied = applyCompoundTerminalPolicy(payload, {
      allowed: ["scholarly_research_answer", "typed_failure"],
      forbidden: [],
      requiredTerminalKind: "scholarly_research_answer",
    });

    expect(policy).toMatchObject({
      active: true,
      required_terminal_kind: "scholarly_research_answer",
    });
    expect(policy.allowed_terminal_artifact_kinds).toContain("scholarly_research_answer");
    expect(applied.requiredTerminalKind).toBe("scholarly_research_answer");
    expect(applied.allowed).toContain("scholarly_research_answer");
  });

  it("reads compound terminal policy from the runtime intent packet itinerary", () => {
    const payload = {
      runtime_intent_packet: {
        schema: "helix.runtime_intent_packet.v1",
        capability_itinerary: {
          terminal_success_criteria: {
            compound_terminal_policy: "synthesize_from_satisfied_subgoal_observations",
          },
          compound_capability_contract: {
            subgoals: [
              {
                requested_capability: "docs-viewer.locate_in_doc",
                runtime_capability: "docs-viewer.locate_in_doc",
                capability_family: "docs_viewer",
              },
              {
                requested_capability: "scientific-calculator.solve_expression",
                runtime_capability: "scientific-calculator.solve_expression",
                capability_family: "calculator",
              },
            ],
          },
        },
      },
    };

    const policy = readCompoundTerminalPolicy(payload);

    expect(policy).toMatchObject({
      active: true,
      source: "capability_itinerary.terminal_success_criteria",
      required_terminal_kind: "doc_evidence_synthesis_answer",
    });
    expect(policy.allowed_terminal_artifact_kinds).toEqual(expect.arrayContaining([
      "compound_evidence_synthesis_answer",
      "doc_evidence_synthesis_answer",
    ]));
    expect(policy.forbidden_terminal_artifact_kinds).toEqual(expect.arrayContaining([
      "tool_receipt",
      "calculator_receipt",
      "workspace_action_receipt",
    ]));
  });

  it("does not let stale compound terminal declarations re-allow receipt terminals", () => {
    const payload = {
      capability_itinerary: {
        terminal_success_criteria: {
          compound_terminal_policy: "synthesize_from_satisfied_subgoal_observations",
          allowed_terminal_artifact_kinds: [
            "tool_receipt",
            "calculator_receipt",
            "model_synthesized_answer",
          ],
          required_terminal_kind: "tool_receipt",
        },
      },
      compound_capability_contract: {
        subgoals: [
          {
            requested_capability: "internet_search.web_research",
            runtime_capability: "internet_search.web_research",
            capability_family: "internet_search",
          },
          {
            requested_capability: "helix_ask.reflect_theory_context",
            runtime_capability: "helix_ask.reflect_theory_context",
            capability_family: "theory_locator",
          },
          {
            requested_capability: "scientific-calculator.solve_expression",
            runtime_capability: "scientific-calculator.solve_expression",
            capability_family: "calculator",
          },
        ],
      },
      compound_capability_synthesis_readiness: {
        applies: true,
        required_terminal_kind: "calculator_receipt",
        synthesis_terminal_kind: "model_synthesized_answer",
      },
    };

    const policy = readCompoundTerminalPolicy(payload);
    const applied = applyCompoundTerminalPolicy(payload, {
      allowed: ["tool_receipt", "calculator_receipt"],
      forbidden: [],
      requiredTerminalKind: "tool_receipt",
    });

    expect(policy.active).toBe(true);
    expect(policy.allowed_terminal_artifact_kinds).toEqual([
      "final_answer_draft",
      "compound_evidence_synthesis_answer",
      "model_synthesized_answer",
    ]);
    expect(policy.allowed_terminal_artifact_kinds).not.toContain("compound_research_locator_answer");
    expect(policy.forbidden_terminal_artifact_kinds).toEqual(expect.arrayContaining([
      "tool_receipt",
      "calculator_receipt",
    ]));
    expect(policy.required_terminal_kind).toBe("compound_evidence_synthesis_answer");
    expect(applied.allowed).toEqual([
      "final_answer_draft",
      "compound_evidence_synthesis_answer",
      "model_synthesized_answer",
    ]);
    expect(applied.requiredTerminalKind).toBe("compound_evidence_synthesis_answer");
  });

  it("allows compound research locator terminal only for research plus theory without docs or calculator", () => {
    const payload = {
      capability_itinerary: {
        terminal_success_criteria: {
          compound_terminal_policy: "synthesize_from_satisfied_subgoal_observations",
          allowed_terminal_artifact_kinds: [
            "compound_research_locator_answer",
            "model_synthesized_answer",
          ],
          required_terminal_kind: "compound_research_locator_answer",
        },
      },
      compound_capability_contract: {
        subgoals: [
          {
            requested_capability: "internet_search.web_research",
            runtime_capability: "internet_search.web_research",
            capability_family: "internet_search",
          },
          {
            requested_capability: "helix_ask.reflect_theory_context",
            runtime_capability: "helix_ask.reflect_theory_context",
            capability_family: "theory_locator",
          },
        ],
      },
    };

    const policy = readCompoundTerminalPolicy(payload);

    expect(policy.active).toBe(true);
    expect(policy.allowed_terminal_artifact_kinds).toEqual(expect.arrayContaining([
      "final_answer_draft",
      "compound_evidence_synthesis_answer",
      "model_synthesized_answer",
      "compound_research_locator_answer",
    ]));
    expect(policy.required_terminal_kind).toBe("compound_research_locator_answer");
  });

  it("keeps compound required terminal kind inside the sanitized allowed terminal set", () => {
    const payload = {
      capability_itinerary: {
        terminal_success_criteria: {
          compound_terminal_policy: "synthesize_from_satisfied_subgoal_observations",
          allowed_terminal_artifact_kinds: ["doc_summary", "model_synthesized_answer"],
          required_terminal_kind: "model_synthesized_answer",
        },
      },
      compound_capability_contract: {
        subgoals: [
          {
            requested_capability: "docs-viewer.locate_in_doc",
            runtime_capability: "docs-viewer.locate_in_doc",
            capability_family: "docs_viewer",
          },
          {
            requested_capability: "scientific-calculator.solve_expression",
            runtime_capability: "scientific-calculator.solve_expression",
            capability_family: "calculator",
          },
        ],
      },
    };

    const policy = readCompoundTerminalPolicy(payload);

    expect(policy.active).toBe(true);
    expect(policy.allowed_terminal_artifact_kinds).toEqual(expect.arrayContaining([
      "final_answer_draft",
      "compound_evidence_synthesis_answer",
      "model_synthesized_answer",
      "doc_evidence_synthesis_answer",
    ]));
    expect(policy.allowed_terminal_artifact_kinds).not.toContain("doc_summary");
    expect(policy.required_terminal_kind).toBe("doc_evidence_synthesis_answer");
  });

  it("does not activate compound terminal policy for a single explicit subgoal contract", () => {
    const payload = {
      compound_capability_contract: {
        terminal_policy: "synthesize_from_satisfied_subgoal_observations",
        subgoals: [
          {
            requested_capability: "scientific-calculator.solve_expression",
            runtime_capability: "scientific-calculator.solve_expression",
            capability_family: "calculator",
          },
        ],
      },
    };
    const policy = readCompoundTerminalPolicy(payload);
    const applied = applyCompoundTerminalPolicy(payload, {
      allowed: ["workstation_tool_evaluation"],
      forbidden: [],
      requiredTerminalKind: "workstation_tool_evaluation",
    });

    expect(policy).toMatchObject({
      active: false,
      allowed_terminal_artifact_kinds: [],
      forbidden_terminal_artifact_kinds: [],
      required_terminal_kind: null,
      source: null,
    });
    expect(applied).toMatchObject({
      allowed: ["workstation_tool_evaluation"],
      forbidden: [],
      requiredTerminalKind: "workstation_tool_evaluation",
    });
  });

  it("does not let lexical tool mentions override a capability-help terminal contract", () => {
    const payload = {
      canonical_goal_frame: {
        goal_kind: "capability_help",
        required_terminal_kind: "capability_help_summary",
      },
      compound_capability_contract: {
        subgoals: [
          { requested_capability: "helix_ask.inspect_capability_catalog", capability_family: "capability_catalog" },
          { requested_capability: "image_lens.inspect", capability_family: "visual_capture" },
        ],
      },
    };

    const applied = applyCompoundTerminalPolicy(payload, {
      allowed: ["capability_help_summary", "typed_failure"],
      forbidden: [],
      requiredTerminalKind: "capability_help_summary",
    });

    expect(applied.policy.active).toBe(false);
    expect(applied.requiredTerminalKind).toBe("capability_help_summary");
    expect(applied.allowed).toEqual(["capability_help_summary", "typed_failure"]);
  });

  it("does not let stale itinerary criteria activate compound terminal policy for one subgoal", () => {
    const payload = {
      capability_itinerary: {
        terminal_success_criteria: {
          compound_terminal_policy: "synthesize_from_satisfied_subgoal_observations",
          allowed_terminal_artifact_kinds: ["model_synthesized_answer"],
          required_terminal_kind: "model_synthesized_answer",
        },
      },
      compound_capability_contract: {
        subgoals: [
          {
            requested_capability: "workspace_os.status",
            runtime_capability: "workspace_os.status",
            capability_family: "workspace_os",
          },
        ],
      },
    };
    const policy = readCompoundTerminalPolicy(payload);
    const applied = applyCompoundTerminalPolicy(payload, {
      allowed: ["workspace_status_answer"],
      forbidden: [],
      requiredTerminalKind: "workspace_status_answer",
    });

    expect(policy.active).toBe(false);
    expect(applied).toMatchObject({
      allowed: ["workspace_status_answer"],
      forbidden: [],
      requiredTerminalKind: "workspace_status_answer",
    });
  });

  it("does not let stale synthesis readiness activate compound terminal policy for one subgoal", () => {
    const payload = {
      compound_capability_contract: {
        subgoals: [
          {
            requested_capability: "scientific-calculator.solve_expression",
            runtime_capability: "scientific-calculator.solve_expression",
            capability_family: "calculator",
          },
        ],
      },
      compound_capability_synthesis_readiness: {
        applies: true,
        required_terminal_kind: "model_synthesized_answer",
        synthesis_terminal_kind: "model_synthesized_answer",
      },
    };
    const policy = readCompoundTerminalPolicy(payload);
    const applied = applyCompoundTerminalPolicy(payload, {
      allowed: ["workstation_tool_evaluation"],
      forbidden: [],
      requiredTerminalKind: "workstation_tool_evaluation",
    });

    expect(policy.active).toBe(false);
    expect(applied).toMatchObject({
      allowed: ["workstation_tool_evaluation"],
      forbidden: [],
      requiredTerminalKind: "workstation_tool_evaluation",
    });
  });

  it("preserves semantic objective families in compound itineraries instead of flattening to admission lanes", () => {
    const cases = [
      {
        capability: "image_lens.inspect",
        family: "visual_capture",
        notFamily: "situation_run",
      },
      {
        capability: "live_env.query_micro_reasoner_presets",
        family: "live_source_mail",
        notFamily: "live_environment",
      },
      {
        capability: "helix_ask.reflect_ideology_context",
        family: "moral_graph_reflection",
        notFamily: "workstation_action",
      },
      {
        capability: "helix_ask.reflect_civilization_bounds",
        family: "civilization_bounds",
        notFamily: "workstation_action",
      },
    ];

    for (const entry of cases) {
      const contract = contractByCapability(entry.capability);
      const itinerary = buildHelixCapabilityItinerary({
        turnId: `ask:semantic-family:${entry.capability}`.replace(/[^A-Za-z0-9:_-]+/g, "_"),
        promptText: promptFor(contract),
        toolCallAdmissionDecision: admissionFor(`ask:semantic-family:${entry.capability}`, [contract]),
        availableCapabilities: availableCapabilities([contract]),
      });

      expect(itinerary.relevant_tool_families, entry.capability).toContain(entry.family);
      expect(itinerary.relevant_tool_families, entry.capability).not.toContain(entry.notFamily);
      expect(itinerary.planned_steps[0], entry.capability).toMatchObject({
        requested_capability: entry.capability,
        tool_family: entry.family,
      });
    }
  });

  it("exposes compound input bindings on planned itinerary steps", () => {
    const contracts = [
      "internet_search.web_research",
      "helix_ask.reflect_theory_context",
      "scientific-calculator.solve_expression",
    ].map(contractByCapability);
    const turnId = "ask:compound-family:planned-step-bindings";
    const itinerary = buildHelixCapabilityItinerary({
      turnId,
      promptText: promptForChain(contracts),
      toolCallAdmissionDecision: admissionFor(turnId, contracts),
      availableCapabilities: availableCapabilities(contracts),
    });
    const theoryStep = itinerary.planned_steps.find((step) =>
      step.requested_capability === "helix_ask.reflect_theory_context"
    );
    const calculatorStep = itinerary.planned_steps.find((step) =>
      step.requested_capability === "scientific-calculator.solve_expression"
    );
    const internetSubgoal = (itinerary.compound_capability_contract?.subgoals as Array<Record<string, unknown>>)
      .find((subgoal) => subgoal.requested_capability === "internet_search.web_research");
    const theorySubgoal = (itinerary.compound_capability_contract?.subgoals as Array<Record<string, unknown>>)
      .find((subgoal) => subgoal.requested_capability === "helix_ask.reflect_theory_context");

    expect(theoryStep).toMatchObject({
      requested_capability: "helix_ask.reflect_theory_context",
      depends_on_subgoal_ids: [internetSubgoal?.subgoal_id],
      input_bindings: expect.arrayContaining([
        expect.objectContaining({
          arg_name: "source_ref",
          binding_kind: "source_ref",
          from_capability: "internet_search.web_research",
          from_subgoal_id: internetSubgoal?.subgoal_id,
          required: true,
        }),
      ]),
    });
    expect(calculatorStep).toMatchObject({
      requested_capability: "scientific-calculator.solve_expression",
      depends_on_subgoal_ids: [
        internetSubgoal?.subgoal_id,
        theorySubgoal?.subgoal_id,
      ],
      input_bindings: expect.arrayContaining([
        expect.objectContaining({
          arg_name: "support_refs",
          binding_kind: "support_ref",
          from_capability: "internet_search.web_research",
          from_subgoal_id: internetSubgoal?.subgoal_id,
          required_affordance_kinds: expect.arrayContaining(["numeric_value_evidence"]),
          required: true,
        }),
        expect.objectContaining({
          arg_name: "support_refs",
          binding_kind: "support_ref",
          from_capability: "helix_ask.reflect_theory_context",
          from_subgoal_id: theorySubgoal?.subgoal_id,
          required_affordance_kinds: expect.arrayContaining(["calculator_expression_template"]),
          required: true,
        }),
      ]),
      consumed_affordance_kinds: expect.arrayContaining([
        "bound_calculator_expression",
        "calculator_expression_template",
        "numeric_value_evidence",
      ]),
      produced_affordance_kinds: expect.arrayContaining(["calculator_result", "numeric_value_evidence"]),
    });
  });

  it("builds a single-capability contract for every explicit capability", () => {
    for (const contract of explicitCapabilityContractsForTests) {
      const compound = buildHelixCompoundCapabilityContract({
        turnId: `ask:single:${contract.capability}`.replace(/[^A-Za-z0-9:_-]+/g, "_"),
        promptText: promptFor(contract),
      });
      const subgoals = compound?.subgoals ?? [];

      expect(subgoals, contract.capability).toHaveLength(1);
      expect(subgoals[0]?.requested_capability, contract.capability).toBe(contract.capability);
      expect(subgoals[0]?.runtime_capability, contract.capability).toBe(runtimeCapabilityFor(contract));
      expect(subgoals[0]?.capability_family, contract.capability).toBe(contract.capability_family);
      expect(subgoals[0]?.required_args, contract.capability).toEqual(contract.required_args);
      expect(subgoals[0]?.optional_args, contract.capability).toEqual(contract.optional_args);
      expect(subgoals[0]?.required_terminal_kind, contract.capability).toBe(contract.required_terminal_kind);
      expect(subgoals[0]?.required_observation_kinds, contract.capability).toEqual(contract.required_observation_kinds);
      expect(subgoals[0]?.produced_affordance_kinds.length, contract.capability).toBeGreaterThan(0);
      expect(subgoals[0]?.missing_affordance_kinds, contract.capability).toEqual([]);
      expect(subgoals[0]?.forbidden_nearby_capabilities, contract.capability)
        .toEqual(contract.forbidden_nearby_capabilities);
      expect(compound?.requires_all_subgoals, contract.capability).toBe(false);
      const argsHint = subgoals[0]?.args_hint as Record<string, unknown> | undefined;
      for (const requiredArg of contract.required_args) {
        expect(
          requiredArgAliasesFor(contract, requiredArg).some((argName) => argValuePresent(argsHint?.[argName])),
          `${contract.capability}:required_arg:${requiredArg}`,
        ).toBe(true);
      }
    }
  });

  it("extracts narrow required args for retrieval-style subgoals", () => {
    const turnId = "ask:compound-family:narrow-retrieval-args";
    const compound = buildHelixCompoundCapabilityContract({
      turnId,
      promptText:
        "Call workspace-directory.resolve for docs/helix-ask-codex-loop-discipline.md. " +
        "Then call docs-viewer.locate_in_doc to locate the rule of thumb in docs/helix-ask-codex-loop-discipline.md. " +
        "Then call repo-code.search_concept to find terminal authority enforcement. " +
        "Then call internet_search.web_research for OpenAI Codex documentation.",
    });
    const subgoals = compound?.subgoals ?? [];
    const argsFor = (capability: string) =>
      subgoals.find((subgoal) => subgoal.requested_capability === capability)?.args_hint ?? {};

    expect(argsFor("workspace-directory.resolve")).toEqual(expect.objectContaining({
      query: "docs/helix-ask-codex-loop-discipline.md",
      path: "docs/helix-ask-codex-loop-discipline.md",
      limit: 8,
    }));
    expect(argsFor("docs-viewer.locate_in_doc")).toEqual(expect.objectContaining({
      query: "rule of thumb",
      target_transcript: "rule of thumb",
      path: "docs/helix-ask-codex-loop-discipline.md",
    }));
    expect(argsFor("repo-code.search_concept")).toEqual(expect.objectContaining({
      query: "terminal authority enforcement",
      concept: "terminal authority enforcement",
      limit: 5,
    }));
    expect(argsFor("internet_search.web_research")).toEqual({
      query: "OpenAI Codex documentation",
    });

    for (const subgoal of subgoals) {
      const serializedArgs = JSON.stringify(subgoal.args_hint);
      expect(serializedArgs, subgoal.requested_capability).not.toMatch(
        /Then call|workspace-directory\.resolve|docs-viewer\.locate_in_doc|repo-code\.search_concept|internet_search\.web_research/,
      );
    }
  });

  it("keeps explicit Moral Graph reflection as a single subgoal when adjacent evidence families are negated", () => {
    const promptText =
      "Use moral-graph.reflect_context. Reflect on delayed disclosure in a shared obligation. Identify the dependency, who needed the information, what deadline preserved agency, and what repair path should be considered. Do not use calculator, image, PDF, page, or web evidence.";
    const compound = buildHelixCompoundCapabilityContract({
      turnId: "ask:compound-family:moral-graph-negative-evidence",
      promptText,
    });

    expect(compound).toMatchObject({
      prompt_shape: "single_capability",
      requires_all_subgoals: false,
      required_capabilities: ["moral-graph.reflect_context"],
    });
    expect(compound?.subgoals).toHaveLength(1);
    expect(compound?.subgoals[0]).toMatchObject({
      requested_capability: "moral-graph.reflect_context",
      runtime_capability: "moral-graph.reflect_context",
      capability_family: "moral_graph_reflection",
      source_target: "moral_graph",
    });
    expect(JSON.stringify(compound)).not.toMatch(
      /scholarly-research\.lookup_papers|internet_search\.web_research|image_lens\.inspect|scientific-calculator\.solve_expression/,
    );

    const admission = buildToolCallAdmissionDecision({
      turnId: "ask:compound-family:moral-graph-negative-evidence",
      promptText,
    });
    expect(admission.source_target).toBe("moral_graph");
    expect(admission.admitted_tool_families).toEqual(["workstation_action"]);
    expect(admission.forbidden_tool_families).toEqual(expect.arrayContaining([
      "calculator",
      "docs_viewer",
      "internet_search",
      "situation_run",
      "scholarly_research",
      "visual_capture",
    ]));

    const itinerary = buildHelixCapabilityItinerary({
      turnId: "ask:compound-family:moral-graph-negative-evidence",
      promptText,
      toolCallAdmissionDecision: admission,
    });
    expect(itinerary.prompt_shape).toBe("single_tool");
    expect(itinerary.relevant_tool_families).toEqual(["moral_graph_reflection"]);
    expect(itinerary.missing_tool_families).toEqual([]);
    expect(itinerary.terminal_success_criteria.required_observation_families).toEqual([
      "moral_graph_reflection",
    ]);
    expect(itinerary.planned_steps.map((step) => step.tool_family)).toEqual(["moral_graph_reflection"]);
    expect(itinerary.planned_steps.map((step) => step.capability_hint)).toEqual(["moral-graph.reflect_context"]);
    expect(itinerary.terminal_success_criteria.required_capabilities).toEqual(["moral-graph.reflect_context"]);
  });

  it("removes explicit query labels and compound connectors from extracted args", () => {
    const docs = buildHelixCompoundCapabilityContract({
      turnId: "ask:compound-family:docs-query-label",
      promptText: "Call docs-viewer.locate_in_doc to locate query: rule of thumb.",
    });
    expect(docs?.subgoals[0]?.args_hint).toEqual(expect.objectContaining({
      query: "rule of thumb",
      target_transcript: "rule of thumb",
    }));

    const compound = buildHelixCompoundCapabilityContract({
      turnId: "ask:compound-family:repo-plus-docs-clean-query",
      promptText:
        "Use repo-code.search_concept to find where terminal authority is enforced, plus docs-viewer.locate_in_doc to locate the same rule in the active document.",
    });
    const repoSubgoal = compound?.subgoals.find((subgoal) =>
      subgoal.requested_capability === "repo-code.search_concept"
    );
    expect(repoSubgoal?.args_hint).toEqual(expect.objectContaining({
      query: "terminal authority is enforced",
      concept: "terminal authority is enforced",
    }));
    expect(JSON.stringify(repoSubgoal?.args_hint)).not.toMatch(/\bplus\b|docs-viewer/i);

    const internet = buildHelixCompoundCapabilityContract({
      turnId: "ask:compound-family:internet-query-label",
      promptText: "Call internet_search.web_research for query: Alcubierre metric energy estimates.",
    });
    expect(internet?.subgoals[0]?.args_hint).toEqual({
      query: "Alcubierre metric energy estimates",
    });

    const scholarly = buildHelixCompoundCapabilityContract({
      turnId: "ask:compound-family:scholarly-query-label",
      promptText: "Call scholarly-research.lookup_papers for query: Alcubierre metric energy estimates.",
    });
    expect(scholarly?.subgoals[0]?.args_hint).toEqual({
      query: "Alcubierre metric energy estimates",
      limit: 5,
    });
  });

  it("exposes required and optional argument rails for every explicit capability contract", () => {
    for (const contract of explicitCapabilityContractsForTests) {
      expect(Array.isArray(contract.required_args), contract.capability).toBe(true);
      expect(Array.isArray(contract.optional_args), contract.capability).toBe(true);
    }

    expect(explicitCapabilityContractsForTests.find((contract) =>
      contract.capability === "scientific-calculator.solve_expression"
    )?.required_args).toEqual(["latex"]);
    expect(explicitCapabilityContractsForTests.find((contract) =>
      contract.capability === "repo-code.search_concept"
    )?.required_args).toEqual(["query"]);
    expect(explicitCapabilityContractsForTests.find((contract) =>
      contract.capability === "scholarly-research.lookup_papers"
    )?.required_args).toEqual(["query"]);
    expect(explicitCapabilityContractsForTests.find((contract) =>
      contract.capability === "scholarly-research.fetch_full_text"
    )?.required_args).toEqual(["paper_result_or_source"]);
    expect(explicitCapabilityContractsForTests.find((contract) =>
      contract.capability === "helix.theory.frontierVectorFieldTrace"
    )?.required_args).toEqual(["query"]);
  });

  it("keeps every explicit capability contract structurally complete for the rail contract", () => {
    for (const contract of explicitCapabilityContractsForTests) {
      expect(contract.schema, contract.capability).toBe("helix.explicit_capability_contract.v1");
      expect(contract.capability, contract.capability).toBeTruthy();
      expect(contract.capability_family, contract.capability).toBeTruthy();
      expect(contract.plan_family, contract.capability).toBeTruthy();
      expect(contract.source_target, contract.capability).toBeTruthy();
      expect(contract.admission_families.length, contract.capability).toBeGreaterThan(0);
      expect(contract.required_observation_kinds.length, contract.capability).toBeGreaterThan(0);
      expect(contract.required_terminal_kind, contract.capability).toBeTruthy();
      expect(Array.isArray(contract.allowed_substitutions), contract.capability).toBe(true);
      expect(Array.isArray(contract.forbidden_nearby_capabilities), contract.capability).toBe(true);
      expect(contract.forbidden_nearby_capabilities.length, contract.capability).toBeGreaterThan(0);
    }
  });

  it("keeps every explicit capability on its family-specific terminal product contract", () => {
    for (const contract of explicitCapabilityContractsForTests) {
      expect(
        expectedTerminalKindsByFamily[contract.capability_family],
        contract.capability_family,
      ).toContain(contract.required_terminal_kind);
    }
  });

  it("proves a representative single-capability rail for every explicit tool family", () => {
    for (const contract of representativesByCapabilityFamily()) {
      assertCompletedSingleCapabilityRail(contract);
    }
  });

  it("keeps every representative family composable with the calculator contract", () => {
    const calculator = explicitCapabilityContractsForTests.find((contract) =>
      contract.capability === "scientific-calculator.solve_expression"
    );
    expect(calculator).toBeTruthy();

    for (const contract of representativesByCapabilityFamily()) {
      if (contract.capability_family === "calculator") continue;
      assertPairContract(contract, calculator as ExplicitContract);
    }
  });

  it("keeps every explicit capability composable with the calculator contract", () => {
    const calculator = explicitCapabilityContractsForTests.find((contract) =>
      contract.capability === "scientific-calculator.solve_expression"
    );
    expect(calculator).toBeTruthy();

    for (const contract of explicitCapabilityContractsForTests) {
      if (contract.capability === calculator?.capability) continue;
      assertPairContract(contract, calculator as ExplicitContract);
    }
  });

  it("keeps every representative family composable with workspace_os.status", () => {
    const workspace = explicitCapabilityContractsForTests.find((contract) =>
      contract.capability === "workspace_os.status"
    );
    expect(workspace).toBeTruthy();

    for (const contract of representativesByCapabilityFamily()) {
      if (contract.capability_family === "workspace_diagnostic") continue;
      assertPairContract(contract, workspace as ExplicitContract);
    }
  });

  it("keeps every explicit capability composable with workspace_os.status", () => {
    const workspace = explicitCapabilityContractsForTests.find((contract) =>
      contract.capability === "workspace_os.status"
    );
    expect(workspace).toBeTruthy();

    for (const contract of explicitCapabilityContractsForTests) {
      if (contract.capability === workspace?.capability) continue;
      assertPairContract(contract, workspace as ExplicitContract);
    }
  });

  it("keeps every representative family composable with docs-viewer.locate_in_doc", () => {
    const docs = explicitCapabilityContractsForTests.find((contract) =>
      contract.capability === "docs-viewer.locate_in_doc"
    );
    expect(docs).toBeTruthy();

    for (const contract of representativesByCapabilityFamily()) {
      if (contract.capability_family === "docs_viewer") continue;
      assertPairContract(contract, docs as ExplicitContract);
    }
  });

  it("keeps every explicit capability composable with docs-viewer.locate_in_doc in both orders", () => {
    const docs = explicitCapabilityContractsForTests.find((contract) =>
      contract.capability === "docs-viewer.locate_in_doc"
    );
    expect(docs).toBeTruthy();

    for (const contract of explicitCapabilityContractsForTests) {
      if (contract.capability === docs?.capability) continue;
      assertPairContract(contract, docs as ExplicitContract);
      assertPairContract(docs as ExplicitContract, contract);
    }
  });

  it("keeps ordered unrelated representative-family pairs intact", () => {
    const representatives = representativesByCapabilityFamily();
    for (let index = 0; index < representatives.length; index += 1) {
      const first = representatives[index];
      const second = representatives[(index + 1) % representatives.length];
      if (first.capability_family === second.capability_family) continue;
      assertPairContract(first, second);
    }
  });

  it("keeps catalog terminal help as synthesis over registry-only evidence", () => {
    const catalog = explicitCapabilityContractsForTests.find((contract) =>
      contract.capability === "helix_ask.inspect_capability_catalog"
    );
    const workspace = explicitCapabilityContractsForTests.find((contract) =>
      contract.capability === "workspace_os.status"
    );
    expect(catalog).toBeTruthy();
    expect(workspace).toBeTruthy();

    const single = buildHelixCompoundCapabilityContract({
      turnId: "ask:catalog:single",
      promptText: promptFor(catalog as ExplicitContract),
    });
    expect(single?.subgoals[0]?.required_observation_kinds).toEqual(["capability_registry"]);

    const compound = buildHelixCompoundCapabilityContract({
      turnId: "ask:catalog:compound",
      promptText: promptForPair(catalog as ExplicitContract, workspace as ExplicitContract),
    });
    expect(compound?.subgoals[0]?.required_observation_kinds).toEqual([
      "capability_registry",
    ]);
  });

  it("extracts only the math expression for calculator subgoals in family compounds", () => {
    const calculator = explicitCapabilityContractsForTests.find((contract) =>
      contract.capability === "scientific-calculator.solve_expression"
    ) as ExplicitContract;
    const representatives = representativesByCapabilityFamily()
      .filter((contract) => contract.capability_family !== "calculator");

    for (const contract of representatives) {
      const compound = buildHelixCompoundCapabilityContract({
        turnId: `ask:math:${contract.capability_family}`.replace(/[^A-Za-z0-9:_-]+/g, "_"),
        promptText: promptForPair(contract, calculator),
      });
      const calculatorSubgoal = compound?.subgoals.find((subgoal) =>
        subgoal.requested_capability === "scientific-calculator.solve_expression"
      );

      expect(calculatorSubgoal?.args_hint, contract.capability_family).toEqual({
        latex: "6*7",
        expression: "6*7",
      });
    }
  });

  it("marks representative-family completed observations as satisfied and synthesis-ready", () => {
    const calculator = explicitCapabilityContractsForTests.find((contract) =>
      contract.capability === "scientific-calculator.solve_expression"
    ) as ExplicitContract;
    const workspace = explicitCapabilityContractsForTests.find((contract) =>
      contract.capability === "workspace_os.status"
    ) as ExplicitContract;

    for (const contract of representativesByCapabilityFamily()) {
      const partner = contract.capability_family === "calculator" ? workspace : calculator;
      const turnId = `ask:completed-family:${contract.capability_family}`.replace(/[^A-Za-z0-9:_-]+/g, "_");
      const itinerary = buildHelixCapabilityItinerary({
        turnId,
        promptText: promptForPair(contract, partner),
        toolCallAdmissionDecision: admissionFor(turnId, [contract, partner]),
        availableCapabilities: availableCapabilities([contract, partner]),
      });
      const artifacts = completedArtifactsForItinerary(turnId, itinerary);
      const state = buildHelixCapabilityItineraryExecutionState({
        capabilityItinerary: itinerary,
        artifacts,
      });

      expect(state.complete, contract.capability_family).toBe(true);
      expect(state.missing_required_capabilities, contract.capability_family).toEqual([]);
      expect(state.compound_subgoal_ledger.map((entry) => entry.satisfaction), contract.capability_family)
        .toEqual(["satisfied", "satisfied"]);

      const readiness = resolveCompoundCapabilitySynthesisReadiness({
        payload: {
          capability_itinerary: {
            ...itinerary,
            execution_state: state,
          },
          capability_itinerary_execution_state: state,
        },
        artifacts,
      });

      expect(readiness.complete, contract.capability_family).toBe(true);
      expect(readiness.synthesis_required, contract.capability_family).toBe(true);
      expect(readiness.support_refs.length, contract.capability_family).toBeGreaterThanOrEqual(2);
      expect(readiness.subgoal_terminal_kinds, contract.capability_family)
        .toEqual(expect.arrayContaining([
          contract.required_terminal_kind,
          partner.required_terminal_kind,
        ]));
      expect(readiness.terminal_contribution_kinds, contract.capability_family)
        .toEqual(readiness.subgoal_terminal_kinds);
      expect(readiness.synthesis_terminal_kind, contract.capability_family).toBe(
        requiresDocEvidenceSynthesis([contract, partner])
          ? "doc_evidence_synthesis_answer"
          : "compound_evidence_synthesis_answer",
      );
      expect(itinerary.terminal_success_criteria.allowed_terminal_artifact_kinds, contract.capability_family)
        .toEqual(expect.arrayContaining([
          requiresDocEvidenceSynthesis([contract, partner])
            ? "doc_evidence_synthesis_answer"
            : "compound_evidence_synthesis_answer",
        ]));
    }
  });

  it("passes the named compound parity acceptance scenarios", () => {
    assertCompletedNamedScenario("docs_then_calculator", [
      "docs-viewer.locate_in_doc",
      "scientific-calculator.solve_expression",
    ], "doc_evidence_synthesis_answer");
    assertCompletedNamedScenario("catalog_then_workspace_status", [
      "helix_ask.inspect_capability_catalog",
      "workspace_os.status",
    ], "compound_evidence_synthesis_answer");
    assertCompletedNamedScenario("repo_then_docs", [
      "repo-code.search_concept",
      "docs-viewer.locate_in_doc",
    ], "doc_evidence_synthesis_answer");
    assertCompletedNamedScenario("internet_reflection_then_calculator", [
      "internet_search.web_research",
      "helix_ask.reflect_theory_context",
      "scientific-calculator.solve_expression",
    ], "compound_evidence_synthesis_answer");
    assertCompletedNamedScenario("scholarly_reflection_then_calculator", [
      "scholarly-research.lookup_papers",
      "helix_ask.reflect_theory_context",
      "scientific-calculator.solve_expression",
    ], "compound_evidence_synthesis_answer");
    assertCompletedNamedScenario("visual_then_calculator", [
      "image_lens.inspect",
      "scientific-calculator.solve_expression",
    ], "compound_evidence_synthesis_answer");
    assertCompletedNamedScenario("civilization_frame_then_bounds_reflection", [
      "helix_ask.build_civilization_scenario_frame",
      "helix_ask.reflect_civilization_bounds",
    ], "compound_evidence_synthesis_answer");
    assertCompletedNamedScenario("moral_graph_reflection_bridge", [
      "helix_ask.reflect_theory_context",
      "helix_ask.reflect_ideology_context",
      "helix_ask.bridge_theory_ideology_context",
    ], "compound_evidence_synthesis_answer");
  });

  it("binds later reflection subgoals to earlier evidence observations", () => {
    const scenarios = [
      {
        name: "internet_to_theory_reflection",
        capabilities: [
          "internet_search.web_research",
          "helix_ask.reflect_theory_context",
          "scientific-calculator.solve_expression",
        ],
        consumer: "helix_ask.reflect_theory_context",
        source: "internet_search.web_research",
      },
      {
        name: "scholarly_to_theory_reflection",
        capabilities: [
          "scholarly-research.lookup_papers",
          "helix_ask.reflect_theory_context",
        ],
        consumer: "helix_ask.reflect_theory_context",
        source: "scholarly-research.lookup_papers",
      },
      {
        name: "docs_to_theory_reflection",
        capabilities: [
          "docs-viewer.locate_in_doc",
          "helix_ask.reflect_theory_context",
        ],
        consumer: "helix_ask.reflect_theory_context",
        source: "docs-viewer.locate_in_doc",
      },
      {
        name: "repo_to_theory_reflection",
        capabilities: [
          "repo-code.search_concept",
          "helix_ask.reflect_theory_context",
        ],
        consumer: "helix_ask.reflect_theory_context",
        source: "repo-code.search_concept",
      },
      {
        name: "repo_to_moral_reflection",
        capabilities: [
          "repo-code.search_concept",
          "helix_ask.reflect_ideology_context",
        ],
        consumer: "helix_ask.reflect_ideology_context",
        source: "repo-code.search_concept",
      },
      {
        name: "civilization_frame_to_bounds_reflection",
        capabilities: [
          "helix_ask.build_civilization_scenario_frame",
          "helix_ask.reflect_civilization_bounds",
        ],
        consumer: "helix_ask.reflect_civilization_bounds",
        source: "helix_ask.build_civilization_scenario_frame",
      },
      {
        name: "live_source_decision_to_voice_callout",
        capabilities: [
          "live_env.record_live_source_mail_decision",
          "live_env.request_interim_voice_callout",
        ],
        consumer: "live_env.request_interim_voice_callout",
        source: "live_env.record_live_source_mail_decision",
      },
      {
        name: "live_source_mail_to_decision",
        capabilities: [
          "live_env.read_processed_live_source_mail",
          "live_env.record_live_source_mail_decision",
        ],
        consumer: "live_env.record_live_source_mail_decision",
        source: "live_env.read_processed_live_source_mail",
      },
    ];

    for (const scenario of scenarios) {
      const contracts = scenario.capabilities.map(contractByCapability);
      const turnId = `ask:named-binding:${scenario.name}`.replace(/[^A-Za-z0-9:_-]+/g, "_");
      const compound = buildHelixCompoundCapabilityContract({
        turnId,
        promptText: promptForChain(contracts),
      });
      const subgoals = (compound?.subgoals ?? []) as Array<Record<string, unknown>>;
      const sourceSubgoal = subgoals.find((subgoal) => subgoal.requested_capability === scenario.source);
      const consumerSubgoal = subgoals.find((subgoal) => subgoal.requested_capability === scenario.consumer);
      const inputBindings = Array.isArray(consumerSubgoal?.input_bindings)
        ? consumerSubgoal.input_bindings as Array<Record<string, unknown>>
        : [];

      expect(sourceSubgoal, scenario.name).toBeTruthy();
      expect(consumerSubgoal, scenario.name).toBeTruthy();
      expect(inputBindings, scenario.name).toEqual(expect.arrayContaining([
        expect.objectContaining({
          from_subgoal_id: sourceSubgoal?.subgoal_id,
          from_capability: scenario.source,
          required: true,
          status: "pending",
        }),
      ]));
    }
  });

  it("binds live-source voice callouts to prior mail decision evidence refs", () => {
    const contracts = [
      "live_env.record_live_source_mail_decision",
      "live_env.request_interim_voice_callout",
    ].map(contractByCapability);
    const turnId = "ask:named-binding:live-source-decision-to-voice-evidence";
    const compound = buildHelixCompoundCapabilityContract({
      turnId,
      promptText: promptForChain(contracts),
    });
    const subgoals = (compound?.subgoals ?? []) as Array<Record<string, unknown>>;
    const decisionSubgoal = subgoals.find((subgoal) =>
      subgoal.requested_capability === "live_env.record_live_source_mail_decision"
    );
    const voiceSubgoal = subgoals.find((subgoal) =>
      subgoal.requested_capability === "live_env.request_interim_voice_callout"
    );
    const inputBindings = Array.isArray(voiceSubgoal?.input_bindings)
      ? voiceSubgoal.input_bindings as Array<Record<string, unknown>>
      : [];

    expect(decisionSubgoal).toBeTruthy();
    expect(voiceSubgoal).toBeTruthy();
    expect(inputBindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        arg_name: "evidence_refs",
        binding_kind: "support_ref",
        from_subgoal_id: decisionSubgoal?.subgoal_id,
        from_capability: "live_env.record_live_source_mail_decision",
        required_observation_kinds: expect.arrayContaining(["stage_play_live_source_mail_decision"]),
        required: true,
        status: "pending",
      }),
    ]));
  });

  it("binds live-source mail observations into later mail decision evidence refs", () => {
    const contracts = [
      "live_env.read_processed_live_source_mail",
      "live_env.process_live_source_mail",
      "live_env.record_live_source_mail_decision",
    ].map(contractByCapability);
    const turnId = "ask:named-binding:live-source-mail-to-decision-evidence";
    const compound = buildHelixCompoundCapabilityContract({
      turnId,
      promptText: promptForChain(contracts),
    });
    const subgoals = (compound?.subgoals ?? []) as Array<Record<string, unknown>>;
    const mailSubgoals = subgoals.filter((subgoal) =>
      subgoal.requested_capability === "live_env.read_processed_live_source_mail" ||
      subgoal.requested_capability === "live_env.process_live_source_mail"
    );
    const decisionSubgoal = subgoals.find((subgoal) =>
      subgoal.requested_capability === "live_env.record_live_source_mail_decision"
    );
    const inputBindings = Array.isArray(decisionSubgoal?.input_bindings)
      ? decisionSubgoal.input_bindings as Array<Record<string, unknown>>
      : [];

    expect(mailSubgoals).toHaveLength(2);
    expect(decisionSubgoal).toBeTruthy();
    expect(inputBindings).toEqual(expect.arrayContaining(
      mailSubgoals.map((subgoal) =>
        expect.objectContaining({
          arg_name: "evidence_refs",
          binding_kind: "support_ref",
          from_subgoal_id: subgoal.subgoal_id,
          from_capability: subgoal.requested_capability,
          required: true,
          status: "pending",
        })
      ),
    ));
  });

  it("binds multiple prior evidence observations into reflection source refs", () => {
    const contracts = [
      "repo-code.search_concept",
      "docs-viewer.locate_in_doc",
      "helix_ask.reflect_theory_context",
    ].map(contractByCapability);
    const turnId = "ask:named-binding:repo-docs-to-theory-reflection";
    const compound = buildHelixCompoundCapabilityContract({
      turnId,
      promptText: promptForChain(contracts),
    });
    const subgoals = (compound?.subgoals ?? []) as Array<Record<string, unknown>>;
    const sourceSubgoals = subgoals.filter((subgoal) =>
      subgoal.requested_capability === "repo-code.search_concept" ||
      subgoal.requested_capability === "docs-viewer.locate_in_doc"
    );
    const reflectionSubgoal = subgoals.find((subgoal) =>
      subgoal.requested_capability === "helix_ask.reflect_theory_context"
    );
    const inputBindings = Array.isArray(reflectionSubgoal?.input_bindings)
      ? reflectionSubgoal.input_bindings as Array<Record<string, unknown>>
      : [];

    expect(sourceSubgoals).toHaveLength(2);
    expect(reflectionSubgoal).toBeTruthy();
    expect(inputBindings).toHaveLength(2);
    expect(inputBindings).toEqual(expect.arrayContaining(
      sourceSubgoals.map((sourceSubgoal) =>
        expect.objectContaining({
          arg_name: "source_refs",
          binding_kind: "source_ref",
          from_subgoal_id: sourceSubgoal.subgoal_id,
          from_capability: sourceSubgoal.requested_capability,
          required: true,
          status: "pending",
        })
      ),
    ));
  });

  it("binds theory and ideology reflections into the bridge subgoal", () => {
    const contracts = [
      "helix_ask.reflect_theory_context",
      "helix_ask.reflect_ideology_context",
      "helix_ask.bridge_theory_ideology_context",
    ].map(contractByCapability);
    const turnId = "ask:named-binding:theory-moral-reflections-to-bridge";
    const compound = buildHelixCompoundCapabilityContract({
      turnId,
      promptText: promptForChain(contracts),
    });
    const subgoals = (compound?.subgoals ?? []) as Array<Record<string, unknown>>;
    const theorySubgoal = subgoals.find((subgoal) =>
      subgoal.requested_capability === "helix_ask.reflect_theory_context"
    );
    const ideologySubgoal = subgoals.find((subgoal) =>
      subgoal.requested_capability === "helix_ask.reflect_ideology_context"
    );
    const bridgeSubgoal = subgoals.find((subgoal) =>
      subgoal.requested_capability === "helix_ask.bridge_theory_ideology_context"
    );
    const inputBindings = Array.isArray(bridgeSubgoal?.input_bindings)
      ? bridgeSubgoal.input_bindings as Array<Record<string, unknown>>
      : [];

    expect(theorySubgoal).toBeTruthy();
    expect(ideologySubgoal).toBeTruthy();
    expect(bridgeSubgoal).toBeTruthy();
    expect(inputBindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        arg_name: "theory_reflection_ref",
        binding_kind: "source_ref",
        from_subgoal_id: theorySubgoal?.subgoal_id,
        from_capability: "helix_ask.reflect_theory_context",
        required: true,
        status: "pending",
      }),
      expect.objectContaining({
        arg_name: "ideology_reflection_ref",
        binding_kind: "source_ref",
        from_subgoal_id: ideologySubgoal?.subgoal_id,
        from_capability: "helix_ask.reflect_ideology_context",
        required: true,
        status: "pending",
      }),
    ]));
  });

  it("binds workspace directory resolution into later docs-viewer target refs", () => {
    const contracts = [
      "workspace-directory.resolve",
      "docs-viewer.locate_in_doc",
    ].map(contractByCapability);
    const turnId = "ask:named-binding:workspace-directory-to-docs-target";
    const compound = buildHelixCompoundCapabilityContract({
      turnId,
      promptText: promptForChain(contracts),
    });
    const subgoals = (compound?.subgoals ?? []) as Array<Record<string, unknown>>;
    const directorySubgoal = subgoals.find((subgoal) =>
      subgoal.requested_capability === "workspace-directory.resolve"
    );
    const docsSubgoal = subgoals.find((subgoal) =>
      subgoal.requested_capability === "docs-viewer.locate_in_doc"
    );
    const inputBindings = Array.isArray(docsSubgoal?.input_bindings)
      ? docsSubgoal.input_bindings as Array<Record<string, unknown>>
      : [];

    expect(directorySubgoal).toBeTruthy();
    expect(docsSubgoal).toBeTruthy();
    expect(inputBindings).toEqual([
      expect.objectContaining({
        arg_name: "target_ref",
        binding_kind: "target_ref",
        from_subgoal_id: directorySubgoal?.subgoal_id,
        from_capability: "workspace-directory.resolve",
        required_observation_kinds: ["workspace_directory_resolution"],
        required: true,
        status: "pending",
      }),
    ]);
  });

  it("binds scholarly lookup results into later full-text fetch paper sources", () => {
    const contracts = [
      "scholarly-research.lookup_papers",
      "scholarly-research.fetch_full_text",
    ].map(contractByCapability);
    const turnId = "ask:named-binding:scholarly-lookup-to-full-text";
    const promptText =
      "Call scholarly-research.lookup_papers for Alcubierre metric energy estimates, then call scholarly-research.fetch_full_text.";
    const compound = buildHelixCompoundCapabilityContract({
      turnId,
      promptText,
    });
    const subgoals = (compound?.subgoals ?? []) as Array<Record<string, unknown>>;
    const lookupSubgoal = subgoals.find((subgoal) =>
      subgoal.requested_capability === "scholarly-research.lookup_papers"
    );
    const fullTextSubgoal = subgoals.find((subgoal) =>
      subgoal.requested_capability === "scholarly-research.fetch_full_text"
    );
    const inputBindings = Array.isArray(fullTextSubgoal?.input_bindings)
      ? fullTextSubgoal.input_bindings as Array<Record<string, unknown>>
      : [];

    expect(lookupSubgoal).toBeTruthy();
    expect(fullTextSubgoal).toBeTruthy();
    expect(inputBindings).toEqual([
      expect.objectContaining({
        arg_name: "paper_result_or_source",
        binding_kind: "source_ref",
        from_subgoal_id: lookupSubgoal?.subgoal_id,
        from_capability: "scholarly-research.lookup_papers",
        required_observation_kinds: ["scholarly_research_observation"],
        required: true,
        status: "pending",
      }),
    ]);

    const itinerary = buildHelixCapabilityItinerary({
      turnId,
      promptText,
      toolCallAdmissionDecision: admissionFor(turnId, contracts),
      availableCapabilities: availableCapabilities(contracts),
    });
    const artifacts = completedArtifactsForItinerary(turnId, itinerary);
    const state = buildHelixCapabilityItineraryExecutionState({
      capabilityItinerary: itinerary,
      artifacts,
    });
    const lookupEntry = state.compound_subgoal_ledger.find((entry) =>
      entry.requested_capability === "scholarly-research.lookup_papers"
    );
    const fullTextEntry = state.compound_subgoal_ledger.find((entry) =>
      entry.requested_capability === "scholarly-research.fetch_full_text"
    );

    expect(state.complete).toBe(true);
    expect(lookupEntry?.observation_ref).toBeTruthy();
    expect(fullTextEntry?.bound_input_refs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        arg_name: "paper_result_or_source",
        binding_kind: "source_ref",
        from_capability: "scholarly-research.lookup_papers",
        ref: lookupEntry?.observation_ref,
      }),
    ]));
    expect(fullTextEntry?.selected_args).toEqual(expect.objectContaining({
      paper_result_or_source: lookupEntry?.observation_ref,
    }));
  });

  it("binds prior evidence observations into later calculator support refs", () => {
    const scenarios = [
      {
        name: "docs_to_calculator",
        capabilities: [
          "docs-viewer.locate_in_doc",
          "scientific-calculator.solve_expression",
        ],
        source: "docs-viewer.locate_in_doc",
      },
      {
        name: "internet_to_calculator",
        capabilities: [
          "internet_search.web_research",
          "scientific-calculator.solve_expression",
        ],
        source: "internet_search.web_research",
      },
      {
        name: "scholarly_to_calculator",
        capabilities: [
          "scholarly-research.lookup_papers",
          "scientific-calculator.solve_expression",
        ],
        source: "scholarly-research.lookup_papers",
      },
      {
        name: "visual_to_calculator",
        capabilities: [
          "image_lens.inspect",
          "scientific-calculator.solve_expression",
        ],
        source: "image_lens.inspect",
      },
      {
        name: "theory_frontier_trace_to_calculator",
        capabilities: [
          "helix.theory.frontierVectorFieldTrace",
          "scientific-calculator.solve_expression",
        ],
        source: "helix.theory.frontierVectorFieldTrace",
      },
      {
        name: "live_synthetic_data_reflection_to_calculator",
        capabilities: [
          "helix_ask.reflect_live_synthetic_data",
          "scientific-calculator.solve_expression",
        ],
        source: "helix_ask.reflect_live_synthetic_data",
      },
    ];

    for (const scenario of scenarios) {
      const contracts = scenario.capabilities.map(contractByCapability);
      const turnId = `ask:named-calculator-binding:${scenario.name}`.replace(/[^A-Za-z0-9:_-]+/g, "_");
      const compound = buildHelixCompoundCapabilityContract({
        turnId,
        promptText: promptForChain(contracts),
      });
      const subgoals = (compound?.subgoals ?? []) as Array<Record<string, unknown>>;
      const sourceSubgoal = subgoals.find((subgoal) => subgoal.requested_capability === scenario.source);
      const calculatorSubgoal = subgoals.find((subgoal) =>
        subgoal.requested_capability === "scientific-calculator.solve_expression"
      );
      const inputBindings = Array.isArray(calculatorSubgoal?.input_bindings)
        ? calculatorSubgoal.input_bindings as Array<Record<string, unknown>>
        : [];

      expect(sourceSubgoal, scenario.name).toBeTruthy();
      expect(calculatorSubgoal, scenario.name).toBeTruthy();
      expect(inputBindings, scenario.name).toEqual(expect.arrayContaining([
        expect.objectContaining({
          arg_name: "support_refs",
          binding_kind: "support_ref",
          from_subgoal_id: sourceSubgoal?.subgoal_id,
          from_capability: scenario.source,
          required: true,
          status: "pending",
        }),
      ]));
    }
  });

  it("binds retrieval and reflection observations into later calculator support refs", () => {
    const scenarios = [
      {
        name: "internet-reflection-calculator",
        source: "internet_search.web_research",
      },
      {
        name: "scholarly-reflection-calculator",
        source: "scholarly-research.lookup_papers",
      },
    ];

    for (const scenario of scenarios) {
      const contracts = [
        scenario.source,
        "helix_ask.reflect_theory_context",
        "scientific-calculator.solve_expression",
      ].map(contractByCapability);
      const turnId = `ask:named-calculator-binding:${scenario.name}`;
      const compound = buildHelixCompoundCapabilityContract({
        turnId,
        promptText: promptForChain(contracts),
      });
      const subgoals = (compound?.subgoals ?? []) as Array<Record<string, unknown>>;
      const calculatorSubgoal = subgoals.find((subgoal) =>
        subgoal.requested_capability === "scientific-calculator.solve_expression"
      );
      const inputBindings = Array.isArray(calculatorSubgoal?.input_bindings)
        ? calculatorSubgoal.input_bindings as Array<Record<string, unknown>>
        : [];

      expect(calculatorSubgoal, scenario.name).toBeTruthy();
      expect(inputBindings, scenario.name).toEqual(expect.arrayContaining([
        expect.objectContaining({
          arg_name: "support_refs",
          binding_kind: "support_ref",
          from_capability: scenario.source,
          required: true,
          status: "pending",
        }),
        expect.objectContaining({
          arg_name: "support_refs",
          binding_kind: "support_ref",
          from_capability: "helix_ask.reflect_theory_context",
          required: true,
          status: "pending",
        }),
      ]));
    }
  });

  it("materializes resolved input bindings into subgoal selected args", () => {
    const contracts = [
      "internet_search.web_research",
      "helix_ask.reflect_theory_context",
      "scientific-calculator.solve_expression",
    ].map(contractByCapability);
    const turnId = "ask:compound-family:materialized-bound-args";
    const itinerary = buildHelixCapabilityItinerary({
      turnId,
      promptText: promptForChain(contracts),
      toolCallAdmissionDecision: admissionFor(turnId, contracts),
      availableCapabilities: availableCapabilities(contracts),
    });
    const artifacts = completedArtifactsForItinerary(turnId, itinerary);
    const state = buildHelixCapabilityItineraryExecutionState({
      capabilityItinerary: itinerary,
      artifacts,
    });
    const internetEntry = state.compound_subgoal_ledger.find((entry) =>
      entry.requested_capability === "internet_search.web_research"
    );
    const theoryEntry = state.compound_subgoal_ledger.find((entry) =>
      entry.requested_capability === "helix_ask.reflect_theory_context"
    );
    const calculatorEntry = state.compound_subgoal_ledger.find((entry) =>
      entry.requested_capability === "scientific-calculator.solve_expression"
    );
    const internetObservationRef = internetEntry?.observation_ref;
    const theoryObservationRef = theoryEntry?.observation_ref;

    expect(state.complete).toBe(true);
    expect(internetObservationRef).toBeTruthy();
    expect(theoryObservationRef).toBeTruthy();
    expect(theoryEntry?.bound_input_refs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        arg_name: "source_ref",
        binding_kind: "source_ref",
        from_capability: "internet_search.web_research",
        ref: internetObservationRef,
      }),
    ]));
    expect(theoryEntry?.selected_args).toEqual(expect.objectContaining({
      source_ref: internetObservationRef,
    }));
    expect(calculatorEntry?.bound_input_refs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        arg_name: "support_refs",
        binding_kind: "support_ref",
        from_capability: "internet_search.web_research",
        ref: internetObservationRef,
      }),
      expect.objectContaining({
        arg_name: "support_refs",
        binding_kind: "support_ref",
        from_capability: "helix_ask.reflect_theory_context",
        ref: theoryObservationRef,
      }),
    ]));
    expect(calculatorEntry?.selected_args).toEqual(expect.objectContaining({
      support_refs: expect.arrayContaining([
        internetObservationRef,
        theoryObservationRef,
      ]),
    }));
  });

  it("fails a later calculator subgoal when its required evidence binding is unresolved", () => {
    const docs = contractByCapability("docs-viewer.locate_in_doc");
    const calculator = contractByCapability("scientific-calculator.solve_expression");
    const turnId = "ask:compound-family:calculator-unresolved-evidence-binding";
    const itinerary = buildHelixCapabilityItinerary({
      turnId,
      promptText: promptForPair(docs, calculator),
      toolCallAdmissionDecision: admissionFor(turnId, [docs, calculator]),
      availableCapabilities: availableCapabilities([docs, calculator]),
    });
    const calculatorSubgoal = ((itinerary.compound_capability_contract?.subgoals ?? []) as Array<Record<string, unknown>>)
      .find((subgoal) => subgoal.requested_capability === calculator.capability);
    const state = buildHelixCapabilityItineraryExecutionState({
      capabilityItinerary: itinerary,
      artifacts: [
        {
          artifact_id: `${turnId}:calculator:runtime_tool_call`,
          kind: "runtime_tool_call",
          payload: {
            capability_key: runtimeCapabilityFor(calculator),
            compound_subgoal_id: calculatorSubgoal?.subgoal_id,
            args: calculatorSubgoal?.args_hint ?? {},
          },
        },
        {
          artifact_id: `${turnId}:calculator:runtime_tool_observation`,
          kind: "runtime_tool_observation",
          payload: {
            capability_key: runtimeCapabilityFor(calculator),
            compound_subgoal_id: calculatorSubgoal?.subgoal_id,
            status: "completed",
          },
        },
        {
          artifact_id: `${turnId}:calculator:receipt`,
          kind: "calculator_receipt",
          payload: {
            schema: "helix.calculator_receipt.v1",
            capability_key: runtimeCapabilityFor(calculator),
            compound_subgoal_id: calculatorSubgoal?.subgoal_id,
            status: "completed",
            calculator_setup: calculatorSubgoal?.args_hint ?? {},
          },
        },
      ],
    });
    const calculatorEntry = state.compound_subgoal_ledger.find((entry) =>
      entry.requested_capability === calculator.capability
    );

    expect(state.complete).toBe(false);
    expect(calculatorEntry).toMatchObject({
      requested_capability: "scientific-calculator.solve_expression",
      rail_status: "fail_closed",
      rail_failure_code: "input_binding_missing",
      first_broken_rail: "evidence_reentry",
      repair_target: "reentry_gate",
    });
    expect(state.missing_required_capabilities).toContain("scientific-calculator.solve_expression");
  });

  it("fails a scholarly full-text subgoal when its required lookup binding is unresolved", () => {
    const lookup = contractByCapability("scholarly-research.lookup_papers");
    const fullText = contractByCapability("scholarly-research.fetch_full_text");
    const turnId = "ask:compound-family:scholarly-full-text-unresolved-lookup-binding";
    const itinerary = buildHelixCapabilityItinerary({
      turnId,
      promptText:
        "Call scholarly-research.lookup_papers for Alcubierre metric energy estimates, then call scholarly-research.fetch_full_text.",
      toolCallAdmissionDecision: admissionFor(turnId, [lookup, fullText]),
      availableCapabilities: availableCapabilities([lookup, fullText]),
    });
    const fullTextSubgoal = ((itinerary.compound_capability_contract?.subgoals ?? []) as Array<Record<string, unknown>>)
      .find((subgoal) => subgoal.requested_capability === fullText.capability);
    const state = buildHelixCapabilityItineraryExecutionState({
      capabilityItinerary: itinerary,
      artifacts: [
        {
          artifact_id: `${turnId}:full-text:runtime_tool_call`,
          kind: "runtime_tool_call",
          payload: {
            capability_key: runtimeCapabilityFor(fullText),
            compound_subgoal_id: fullTextSubgoal?.subgoal_id,
            args: {
              paper_result_or_source: "arxiv:warp-1994",
            },
          },
        },
        {
          artifact_id: `${turnId}:full-text:runtime_tool_observation`,
          kind: "runtime_tool_observation",
          payload: {
            capability_key: runtimeCapabilityFor(fullText),
            compound_subgoal_id: fullTextSubgoal?.subgoal_id,
            status: "completed",
          },
        },
        {
          artifact_id: `${turnId}:full-text:scholarly_full_text_observation`,
          kind: "scholarly_full_text_observation",
          payload: {
            schema: "helix.scholarly_full_text_observation.v1",
            capability: runtimeCapabilityFor(fullText),
            capability_key: runtimeCapabilityFor(fullText),
            compound_subgoal_id: fullTextSubgoal?.subgoal_id,
          },
        },
      ],
    });
    const fullTextEntry = state.compound_subgoal_ledger.find((entry) =>
      entry.requested_capability === fullText.capability
    );

    expect(state.complete).toBe(false);
    expect(fullTextEntry).toMatchObject({
      requested_capability: "scholarly-research.fetch_full_text",
      rail_status: "fail_closed",
      rail_failure_code: "input_binding_missing",
      first_broken_rail: "evidence_reentry",
      repair_target: "reentry_gate",
    });
    expect(fullTextEntry?.unresolved_input_bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        arg_name: "paper_result_or_source",
        from_capability: "scholarly-research.lookup_papers",
        required: true,
      }),
    ]));
    expect(state.missing_required_capabilities).toContain("scholarly-research.lookup_papers");
    expect(state.missing_required_capabilities).toContain("scholarly-research.fetch_full_text");
  });

  it("fails representative-family invalid runtime arguments closed at the subgoal rail", () => {
    const calculator = explicitCapabilityContractsForTests.find((contract) =>
      contract.capability === "scientific-calculator.solve_expression"
    ) as ExplicitContract;
    const workspace = explicitCapabilityContractsForTests.find((contract) =>
      contract.capability === "workspace_os.status"
    ) as ExplicitContract;

    for (const contract of representativesByCapabilityFamily()) {
      const partner = contract.capability_family === "calculator" ? workspace : calculator;
      const turnId = `ask:invalid-family:${contract.capability_family}`.replace(/[^A-Za-z0-9:_-]+/g, "_");
      const itinerary = buildHelixCapabilityItinerary({
        turnId,
        promptText: promptForPair(contract, partner),
        toolCallAdmissionDecision: admissionFor(turnId, [contract, partner]),
        availableCapabilities: availableCapabilities([contract, partner]),
      });
      const invalidRuntime = runtimeCapabilityFor(contract);
      const invalidSubgoal = ((itinerary.compound_capability_contract?.subgoals ?? []) as Array<Record<string, unknown>>)
        .find((subgoal) => subgoal.requested_capability === contract.capability);
      const state = buildHelixCapabilityItineraryExecutionState({
        capabilityItinerary: itinerary,
        artifacts: [
          {
            artifact_id: `${turnId}:invalid:runtime_tool_call`,
            kind: "runtime_tool_call",
            payload: {
              capability_key: invalidRuntime,
              compound_subgoal_id: invalidSubgoal?.subgoal_id,
              args: {},
            },
          },
          {
            artifact_id: `${turnId}:invalid:runtime_tool_call_validation`,
            kind: "runtime_tool_call_validation",
            payload: {
              capability_key: invalidRuntime,
              compound_subgoal_id: invalidSubgoal?.subgoal_id,
              valid: false,
              errors: ["invalid_arg:missing_required_args"],
            },
          },
        ],
      });
      const invalidEntry = state.compound_subgoal_ledger.find((entry) =>
        entry.requested_capability === contract.capability
      );

      expect(state.complete, contract.capability_family).toBe(false);
      expect(invalidEntry, contract.capability_family).toMatchObject({
        satisfaction: "failed",
        rail_status: "fail_closed",
        rail_failure_code: "invalid_arg:missing_required_args",
        repair_target: "subgoal_argument_extraction",
      });
      expect(state.missing_required_capabilities, contract.capability_family)
        .toContain(contract.capability);
    }
  });

  it("does not count runtime observations when a required subgoal arg is missing", () => {
    const calculator = explicitCapabilityContractsForTests.find((contract) =>
      contract.capability === "scientific-calculator.solve_expression"
    ) as ExplicitContract;
    const turnId = "ask:compound-family:calculator-missing-required-arg";
    const itinerary = buildHelixCapabilityItinerary({
      turnId,
      promptText: "Call scientific-calculator.solve_expression.",
      toolCallAdmissionDecision: admissionFor(turnId, [calculator]),
      availableCapabilities: availableCapabilities([calculator]),
    });
    const calculatorSubgoal = ((itinerary.compound_capability_contract?.subgoals ?? []) as Array<Record<string, unknown>>)
      .find((subgoal) => subgoal.requested_capability === calculator.capability);
    const artifacts = [
      {
        artifact_id: `${turnId}:calculator:runtime_tool_call`,
        kind: "runtime_tool_call",
        payload: {
          capability_key: runtimeCapabilityFor(calculator),
          compound_subgoal_id: calculatorSubgoal?.subgoal_id,
          args: {},
        },
      },
      {
        artifact_id: `${turnId}:calculator:runtime_tool_observation`,
        kind: "runtime_tool_observation",
        payload: {
          capability_key: runtimeCapabilityFor(calculator),
          compound_subgoal_id: calculatorSubgoal?.subgoal_id,
          status: "completed",
        },
      },
      {
        artifact_id: `${turnId}:calculator:declared_observation`,
        kind: "calculator_receipt",
        payload: {
          schema: "helix.calculator_receipt.v1",
          capability_key: runtimeCapabilityFor(calculator),
          compound_subgoal_id: calculatorSubgoal?.subgoal_id,
          status: "completed",
        },
      },
    ];
    const state = buildHelixCapabilityItineraryExecutionState({
      capabilityItinerary: itinerary,
      artifacts,
    });
    const failedEntry = state.compound_subgoal_ledger.find((entry) =>
      entry.requested_capability === calculator.capability
    );

    expect(state.complete).toBe(false);
    expect(failedEntry).toMatchObject({
      requested_capability: "scientific-calculator.solve_expression",
      selected_capability: "scientific-calculator.solve_expression",
      executed_capability: null,
      observation_kind: null,
      observation_ref: null,
      satisfaction: "failed",
      rail_status: "fail_closed",
      rail_failure_code: "missing_required_arg:latex",
      first_broken_rail: "capability_execution",
      repair_target: "subgoal_argument_extraction",
    });
    expect(state.missing_required_capabilities).toContain("scientific-calculator.solve_expression");
  });

  it("fails every required-arg explicit capability closed when runtime args are empty", () => {
    const requiredArgContracts = explicitCapabilityContractsForTests.filter((contract) =>
      contract.required_args.length > 0
    );
    expect(requiredArgContracts.map((contract) => contract.capability)).toEqual(expect.arrayContaining([
      "scientific-calculator.solve_expression",
      "docs-viewer.locate_in_doc",
      "docs-viewer.doc_equation_context",
      "repo-code.search_concept",
      "workspace-directory.resolve",
      "internet_search.web_research",
      "scholarly-research.lookup_papers",
    ]));

    for (const contract of requiredArgContracts) {
      const turnId = `ask:compound-family:missing-required-arg:${contract.capability}`
        .replace(/[^A-Za-z0-9:_-]+/g, "_");
      const itinerary = buildHelixCapabilityItinerary({
        turnId,
        promptText: promptFor(contract),
        toolCallAdmissionDecision: admissionFor(turnId, [contract]),
        availableCapabilities: availableCapabilities([contract]),
      });
      const subgoal = ((itinerary.compound_capability_contract?.subgoals ?? []) as Array<Record<string, unknown>>)
        .find((entry) => entry.requested_capability === contract.capability);
      const requiredObservationKind = contract.required_observation_kinds[0] ?? "runtime_tool_observation";
      const state = buildHelixCapabilityItineraryExecutionState({
        capabilityItinerary: itinerary,
        artifacts: [
          {
            artifact_id: `${turnId}:runtime_tool_call`,
            kind: "runtime_tool_call",
            payload: {
              capability_key: runtimeCapabilityFor(contract),
              compound_subgoal_id: subgoal?.subgoal_id,
              args: {},
            },
          },
          {
            artifact_id: `${turnId}:runtime_tool_observation`,
            kind: "runtime_tool_observation",
            payload: {
              capability_key: runtimeCapabilityFor(contract),
              compound_subgoal_id: subgoal?.subgoal_id,
              status: "completed",
            },
          },
          {
            artifact_id: `${turnId}:declared_observation`,
            kind: requiredObservationKind,
            payload: {
              schema: schemaForKind(requiredObservationKind),
              capability_key: runtimeCapabilityFor(contract),
              compound_subgoal_id: subgoal?.subgoal_id,
              status: "completed",
            },
          },
        ],
      });
      const failedEntry = state.compound_subgoal_ledger.find((entry) =>
        entry.requested_capability === contract.capability
      );

      expect(state.complete, contract.capability).toBe(false);
      expect(failedEntry, contract.capability).toMatchObject({
        requested_capability: contract.capability,
        selected_capability: runtimeCapabilityFor(contract),
        executed_capability: null,
        observation_kind: null,
        observation_ref: null,
        satisfaction: "failed",
        rail_status: "fail_closed",
        rail_failure_code: `missing_required_arg:${contract.required_args[0]}`,
        first_broken_rail: "capability_execution",
        repair_target: "subgoal_argument_extraction",
      });
      expect(state.missing_required_capabilities, contract.capability).toContain(contract.capability);
    }
  });

  it("fails a selected subgoal closed when runtime progress has no required observation artifact", () => {
    const repo = explicitCapabilityContractsForTests.find((contract) =>
      contract.capability === "repo-code.search_concept"
    ) as ExplicitContract;
    const turnId = "ask:compound-family:repo-runtime-call-without-observation";
    const itinerary = buildHelixCapabilityItinerary({
      turnId,
      promptText: "Call repo-code.search_concept for query: terminal authority.",
      toolCallAdmissionDecision: admissionFor(turnId, [repo]),
      availableCapabilities: availableCapabilities([repo]),
    });
    const repoSubgoal = ((itinerary.compound_capability_contract?.subgoals ?? []) as Array<Record<string, unknown>>)
      .find((subgoal) => subgoal.requested_capability === repo.capability);
    const state = buildHelixCapabilityItineraryExecutionState({
      capabilityItinerary: itinerary,
      artifacts: [
        {
          artifact_id: `${turnId}:repo:runtime_tool_call`,
          kind: "runtime_tool_call",
          payload: {
            capability_key: runtimeCapabilityFor(repo),
            compound_subgoal_id: repoSubgoal?.subgoal_id,
            args: repoSubgoal?.args_hint ?? {},
          },
        },
      ],
    });
    const failedEntry = state.compound_subgoal_ledger.find((entry) =>
      entry.requested_capability === repo.capability
    );

    expect(state.complete).toBe(false);
    expect(failedEntry).toMatchObject({
      requested_capability: "repo-code.search_concept",
      selected_capability: "repo-code.search_concept",
      executed_capability: null,
      observation_kind: null,
      observation_ref: null,
      satisfaction: "failed",
      rail_status: "fail_closed",
      rail_failure_code: "subgoal_observation_missing",
      first_broken_rail: "observation_artifact",
      repair_target: "observation_materializer",
    });
    expect(state.missing_required_capabilities).toContain("repo-code.search_concept");
  });

  it("does not extract prose after exact expression as calculator math", () => {
    const docs = explicitCapabilityContractsForTests.find((contract) =>
      contract.capability === "docs-viewer.locate_in_doc"
    ) as ExplicitContract;
    const calculator = explicitCapabilityContractsForTests.find((contract) =>
      contract.capability === "scientific-calculator.solve_expression"
    ) as ExplicitContract;
    const turnId = "ask:compound-family:calculator-prose-expression";
    const itinerary = buildHelixCapabilityItinerary({
      turnId,
      promptText:
        "Use docs-viewer.locate_in_doc to cite the claim, then call scientific-calculator.solve_expression with this exact expression: explain why receipts matter.",
      toolCallAdmissionDecision: admissionFor(turnId, [docs, calculator]),
      availableCapabilities: availableCapabilities([docs, calculator]),
    });
    const calculatorSubgoal = ((itinerary.compound_capability_contract?.subgoals ?? []) as Array<Record<string, unknown>>)
      .find((subgoal) => subgoal.requested_capability === calculator.capability);
    const state = buildHelixCapabilityItineraryExecutionState({
      capabilityItinerary: itinerary,
      artifacts: [],
    });
    const failedEntry = state.compound_subgoal_ledger.find((entry) =>
      entry.requested_capability === calculator.capability
    );

    expect(calculatorSubgoal?.args_hint).toEqual({});
    expect(state.complete).toBe(false);
    expect(failedEntry).toMatchObject({
      requested_capability: "scientific-calculator.solve_expression",
      args: {},
      executed_capability: null,
      observation_kind: null,
      observation_ref: null,
      satisfaction: "failed",
      rail_status: "fail_closed",
      rail_failure_code: "missing_required_arg:latex",
      first_broken_rail: "capability_execution",
      repair_target: "subgoal_argument_extraction",
    });
    expect(state.missing_required_capabilities).toContain("scientific-calculator.solve_expression");
  });

  it("extracts a valid calculator expression before trailing explanation prose", () => {
    const docs = explicitCapabilityContractsForTests.find((contract) =>
      contract.capability === "docs-viewer.locate_in_doc"
    ) as ExplicitContract;
    const calculator = explicitCapabilityContractsForTests.find((contract) =>
      contract.capability === "scientific-calculator.solve_expression"
    ) as ExplicitContract;
    const turnId = "ask:compound-family:calculator-expression-before-explanation";
    const itinerary = buildHelixCapabilityItinerary({
      turnId,
      promptText:
        "Use docs-viewer.locate_in_doc to cite the claim, then call scientific-calculator.solve_expression with this exact expression: ((sqrt(81)+ln(e^3))*7-5^2)/2, and explain the connection.",
      toolCallAdmissionDecision: admissionFor(turnId, [docs, calculator]),
      availableCapabilities: availableCapabilities([docs, calculator]),
    });
    const calculatorSubgoal = ((itinerary.compound_capability_contract?.subgoals ?? []) as Array<Record<string, unknown>>)
      .find((subgoal) => subgoal.requested_capability === calculator.capability);

    expect(calculatorSubgoal?.args_hint).toMatchObject({
      latex: "((sqrt(81)+ln(e^3))*7-5^2)/2",
      expression: "((sqrt(81)+ln(e^3))*7-5^2)/2",
    });
  });

  it("fails internet-search compounds closed on provider config without consuming loop budget", () => {
    const internetSearch = explicitCapabilityContractsForTests.find((contract) =>
      contract.capability === "internet_search.web_research"
    ) as ExplicitContract;
    const calculator = explicitCapabilityContractsForTests.find((contract) =>
      contract.capability === "scientific-calculator.solve_expression"
    ) as ExplicitContract;
    const turnId = "ask:compound-family:internet-config-missing";
    const itinerary = buildHelixCapabilityItinerary({
      turnId,
      promptText: promptForPair(internetSearch, calculator),
      toolCallAdmissionDecision: admissionFor(turnId, [internetSearch, calculator]),
      availableCapabilities: availableCapabilities([internetSearch, calculator]),
    });
    const internetSubgoal = ((itinerary.compound_capability_contract?.subgoals ?? []) as Array<Record<string, unknown>>)
      .find((subgoal) => subgoal.requested_capability === internetSearch.capability);
    const state = buildHelixCapabilityItineraryExecutionState({
      capabilityItinerary: itinerary,
      artifacts: [
        {
          artifact_id: `${turnId}:internet:runtime_tool_call`,
          kind: "runtime_tool_call",
          payload: {
            capability_key: runtimeCapabilityFor(internetSearch),
            compound_subgoal_id: internetSubgoal?.subgoal_id,
            args: internetSubgoal?.args_hint ?? {},
          },
        },
        {
          artifact_id: `${turnId}:internet:runtime_tool_call_validation`,
          kind: "runtime_tool_call_validation",
          payload: {
            capability_key: runtimeCapabilityFor(internetSearch),
            compound_subgoal_id: internetSubgoal?.subgoal_id,
            valid: false,
            errors: ["config_missing"],
          },
        },
      ],
    });
    const failedEntry = state.compound_subgoal_ledger.find((entry) =>
      entry.requested_capability === internetSearch.capability
    );

    expect(state.complete).toBe(false);
    expect(failedEntry).toMatchObject({
      requested_capability: "internet_search.web_research",
      satisfaction: "failed",
      rail_status: "fail_closed",
      first_broken_rail: "config",
      rail_failure_code: "config_missing",
      repair_target: "operator_config",
    });
    expect(failedEntry?.rail_failure_code).not.toBe("agent_loop_budget_exhausted");
    expect(state.missing_required_capabilities).toContain("internet_search.web_research");
  });

  it("fails repo-code compounds closed on weak evidence repair without budget exhaustion", () => {
    const repo = explicitCapabilityContractsForTests.find((contract) =>
      contract.capability === "repo-code.search_concept"
    ) as ExplicitContract;
    const calculator = explicitCapabilityContractsForTests.find((contract) =>
      contract.capability === "scientific-calculator.solve_expression"
    ) as ExplicitContract;
    const turnId = "ask:compound-family:repo-weak-evidence";
    const itinerary = buildHelixCapabilityItinerary({
      turnId,
      promptText: promptForPair(repo, calculator),
      toolCallAdmissionDecision: admissionFor(turnId, [repo, calculator]),
      availableCapabilities: availableCapabilities([repo, calculator]),
    });
    const repoSubgoal = ((itinerary.compound_capability_contract?.subgoals ?? []) as Array<Record<string, unknown>>)
      .find((subgoal) => subgoal.requested_capability === repo.capability);
    const state = buildHelixCapabilityItineraryExecutionState({
      capabilityItinerary: itinerary,
      artifacts: [
        {
          artifact_id: `${turnId}:repo:runtime_tool_call`,
          kind: "runtime_tool_call",
          payload: {
            capability_key: runtimeCapabilityFor(repo),
            compound_subgoal_id: repoSubgoal?.subgoal_id,
            args: repoSubgoal?.args_hint ?? {},
          },
        },
        {
          artifact_id: `${turnId}:repo:runtime_tool_call_validation`,
          kind: "runtime_tool_call_validation",
          payload: {
            capability_key: runtimeCapabilityFor(repo),
            compound_subgoal_id: repoSubgoal?.subgoal_id,
            valid: false,
            errors: ["weak_evidence_repair_loop"],
          },
        },
      ],
    });
    const failedEntry = state.compound_subgoal_ledger.find((entry) =>
      entry.requested_capability === repo.capability
    );

    expect(state.complete).toBe(false);
    expect(failedEntry).toMatchObject({
      requested_capability: "repo-code.search_concept",
      required_observation_kinds: repo.required_observation_kinds,
      satisfaction: "failed",
      rail_status: "fail_closed",
      first_broken_rail: "evidence_reentry",
      rail_failure_code: "weak_evidence_repair_loop",
      repair_target: "repo_retrieval_repair_policy",
    });
    expect(failedEntry?.rail_failure_code).not.toBe("agent_loop_budget_exhausted");
    expect(state.missing_required_capabilities).toContain("repo-code.search_concept");
  });
});
