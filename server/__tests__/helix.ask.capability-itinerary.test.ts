import { describe, expect, it } from "vitest";
import { HELIX_INTERNET_SEARCH_CAPABILITY } from "@shared/helix-internet-search-observation";
import {
  HELIX_SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
  HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
} from "@shared/helix-scholarly-research-observation";
import type { HelixToolCallAdmissionDecision } from "@shared/helix-tool-call-admission";
import { HELIX_MINECRAFT_ACTOR_STATUS_READ_CAPABILITY } from
  "@shared/helix-environment-connector";
import {
  buildHelixCapabilityItinerary,
  requiredScholarlyCapabilitiesFromCompoundSubgoals,
} from "../services/helix-ask/capability-itinerary";
import { explicitCapabilityContractForCapability } from
  "../services/helix-ask/explicit-capability-contract";
import {
  attachHelixCapabilityItineraryExecutionState,
  buildHelixCapabilityItineraryExecutionState,
  isHelixCapabilityItineraryFamilyObserved,
} from "../services/helix-ask/capability-itinerary-execution";

const scholarlyAdmission = (turnId: string): HelixToolCallAdmissionDecision => ({
  schema: "helix.tool_call_admission_decision.v1",
  turn_id: turnId,
  source_target: "scholarly_research",
  required: true,
  admitted_tool_families: ["scholarly_research"],
  forbidden_terminal_artifact_kinds: [],
  forbidden_routes: [],
  reason: "scholarly_research_requires_source_tool_path",
  assistant_answer: false,
  raw_content_included: false,
});

const availableCapabilities = (keys: string[]) => ({
  schema: "helix.available_capabilities.v1",
  turn_id: "ask:itinerary",
  manifest_role: "model_visible_tool_menu",
  tool_manifest_version: "helix.ask.capability_manifest.v1",
  user_goal_summary: "test",
  canonical_goal_kind: "scholarly_research_lookup",
  model_visible_capability_keys: keys,
  recommended_capability_key: keys[0] ?? null,
  classifier_hints: [],
  capabilities: keys.map((key) => ({
    capability_key: key,
    label: key,
    lane: "retrieval",
    requires_action: true,
    expected_artifacts: [],
    goal_fit: "primary",
    reason: "test",
    model_visible_name: key,
    model_visible_description: key,
    availability: "available",
  })),
  assistant_answer: false,
  raw_content_included: false,
});

describe("Helix Ask capability itinerary", () => {
  it("preserves a required scholarly full-text stage from a compound provider-call contract", () => {
    expect(
      requiredScholarlyCapabilitiesFromCompoundSubgoals([
        {
          mandatory: true,
          requested_capability: HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
          args: {
            scholarly_intent: { requires_full_text: true },
            planned_scholarly_capability_chain: {
              planned_capabilities: [
                HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
                HELIX_SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
              ],
            },
          },
        },
      ]),
    ).toEqual([
      HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
      HELIX_SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
    ]);
  });

  it("requires full-text observation for a natural analytical paper comparison", () => {
    const promptText =
      "Compare the assumptions in arXiv 2105.03079 with the NHM2 whitepaper and explain which mismatch matters most.";
    const itinerary = buildHelixCapabilityItinerary({
      turnId: "ask:itinerary-analytical-paper-comparison",
      promptText,
      toolCallAdmissionDecision: scholarlyAdmission("ask:itinerary-analytical-paper-comparison"),
      availableCapabilities: availableCapabilities([
        HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
        HELIX_SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
      ]),
    });

    expect(itinerary.planned_steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        tool_family: "scholarly_research",
        capability_hint: HELIX_SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
        required_observation_kinds: [
          "scholarly_research_observation",
          "scholarly_full_text_observation",
        ],
      }),
    ]));
    expect(itinerary.terminal_success_criteria.required_capabilities).toEqual([
      HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
      HELIX_SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
    ]);
  });

  it("keeps full text required in a compound Docs and scholarly comparison", () => {
    const promptText =
      "Use docs.search to find the NHM2 current status whitepaper. Then use scholarly-research.lookup_papers for arXiv:2105.03079 and compare their assumptions, explaining where the paper does not validate NHM2.";
    const itinerary = buildHelixCapabilityItinerary({
      turnId: "ask:itinerary-compound-doc-scholarly-full-text",
      promptText,
      toolCallAdmissionDecision: {
        ...scholarlyAdmission("ask:itinerary-compound-doc-scholarly-full-text"),
        source_target: "compound_sources",
        admitted_tool_families: ["docs_viewer", "scholarly_research"],
      },
      availableCapabilities: availableCapabilities([
        "docs.search",
        HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
        HELIX_SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
      ]),
    });

    expect(itinerary.prompt_shape).toBe("compound_tool");
    expect(itinerary.relevant_tool_families).toContain("docs_viewer");
    expect(itinerary.terminal_success_criteria.required_capabilities).toEqual(
      expect.arrayContaining([
        HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
        HELIX_SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
      ]),
    );
  });

  it("derives full-text depth from a natural compound admission list", () => {
    const promptText =
      "Open the NHM2 current status whitepaper in the local docs and compare its source-closure caution with the primary paper arXiv:2105.03079. Explain where they agree and where the paper does not validate NHM2, citing both sources.";
    const itinerary = buildHelixCapabilityItinerary({
      turnId: "ask:itinerary-natural-compound-admission",
      promptText,
      toolCallAdmissionDecision: {
        ...scholarlyAdmission("ask:itinerary-natural-compound-admission"),
        source_target: "scholarly_research",
        admitted_tool_families: ["docs_viewer", "scholarly_research"],
        compound_requested_capabilities: [
          "docs.search",
          HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
        ],
      },
      availableCapabilities: availableCapabilities([
        "docs.search",
        HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
        HELIX_SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
      ]),
    });

    expect(itinerary.terminal_success_criteria.required_capabilities).toContain(
      HELIX_SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
    );
  });

  it("keeps natural lookup-then-full-text work as two required scholarly capabilities", () => {
    const promptText = [
      'Find one PDF-accessible primary paper for this workflow objective: "Magnetar".',
      "Select exactly one paper, fetch or materialize its full text, and report its canonical identity, DOI or arXiv ID when available.",
    ].join(" ");
    const itinerary = buildHelixCapabilityItinerary({
      turnId: "ask:itinerary-magnetar-full-text",
      promptText,
      toolCallAdmissionDecision: scholarlyAdmission("ask:itinerary-magnetar-full-text"),
      availableCapabilities: availableCapabilities([
        HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
        HELIX_SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
      ]),
    });

    expect(itinerary.planned_steps).toEqual([
      expect.objectContaining({
        tool_family: "scholarly_research",
        capability_hint: HELIX_SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
        required_observation_kinds: [
          "scholarly_research_observation",
          "scholarly_full_text_observation",
        ],
      }),
    ]);
    expect(itinerary.terminal_success_criteria.required_capabilities).toEqual([
      HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
      HELIX_SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
    ]);
  });

  it("does not plan research or Image Lens execution for a capability behavior question", () => {
    const itinerary = buildHelixCapabilityItinerary({
      turnId: "ask:itinerary-capability-help",
      promptText:
        "Does your research-paper tool select papers it can parse, or does it first check which papers are openable and then use Image Lens when visual extraction is needed?",
      toolCallAdmissionDecision: {
        schema: "helix.tool_call_admission_decision.v1",
        turn_id: "ask:itinerary-capability-help",
        source_target: "runtime_evidence",
        required: true,
        admitted_tool_families: ["capability_catalog", "runtime_evidence"],
        forbidden_terminal_artifact_kinds: [],
        forbidden_routes: [],
        reason: "capability_catalog_prompt_requires_runtime_catalog_observation",
        assistant_answer: false,
        raw_content_included: false,
      },
    });

    expect(itinerary.compound_capability_contract).toBeUndefined();
    expect(itinerary.relevant_tool_families).not.toContain("scholarly_research");
    expect(itinerary.relevant_tool_families).not.toContain("visual_capture");
    expect(itinerary.terminal_success_criteria.required_capabilities).toEqual([]);
  });

  it("attaches execution state from ledger-only capability itinerary artifacts", () => {
    const turnId = "ask:itinerary-ledger-only-attach";
    const capabilityItinerary = {
      schema: "helix.capability_itinerary.v1",
      terminal_success_criteria: {
        requires_post_observation_synthesis: true,
        required_observation_families: ["docs_viewer"],
        required_capabilities: ["docs-viewer.locate_in_doc"],
      },
      compound_capability_contract: {
        schema: "helix.compound_capability_contract.v1",
        requires_all_subgoals: true,
        subgoals: [
          {
            subgoal_id: `${turnId}:compound_capability_subgoal:1:docs-viewer_locate_in_doc`,
            order: 1,
            capability_family: "docs_viewer",
            requested_capability: "docs-viewer.locate_in_doc",
            runtime_capability: "docs-viewer.locate_in_doc",
          },
        ],
      },
      planned_steps: [
        {
          order: 1,
          requested_capability: "docs-viewer.locate_in_doc",
          runtime_capability: "docs-viewer.locate_in_doc",
        },
      ],
    };
    const payload: Record<string, unknown> = {
      debug: {},
    };
    const missing = attachHelixCapabilityItineraryExecutionState(payload, [
      {
        artifact_id: `${turnId}:capability_itinerary`,
        kind: "capability_itinerary",
        payload: capabilityItinerary,
      },
    ]);

    expect(missing).toEqual(["docs_viewer", "docs-viewer.locate_in_doc"]);
    expect(payload.capability_itinerary).toBe(capabilityItinerary);
    expect(payload.capability_itinerary_execution_state).toMatchObject({
      schema: "helix.capability_itinerary_execution_state.v1",
      applies: true,
      complete: false,
      required_observation_families: ["docs_viewer"],
      missing_observation_families: ["docs_viewer"],
      missing_required_capabilities: ["docs-viewer.locate_in_doc"],
    });
    expect((payload.debug as Record<string, unknown>).capability_itinerary).toBe(capabilityItinerary);
    expect((payload.debug as Record<string, unknown>).capability_itinerary_execution_state).toBe(
      payload.capability_itinerary_execution_state,
    );
  });

  it("counts only successful docs.search gateway packets as Docs observations", () => {
    const packet = (status: string) => ({
      artifact_id: `ask:docs-search-status:workstation_gateway:docs.search:${status}`,
      kind: "provider_gateway_observation_packet",
      payload: {
        schema: "helix.agent_step_observation_packet.v1",
        capability_key: "docs.search",
        status,
      },
    });

    expect(isHelixCapabilityItineraryFamilyObserved("docs_viewer", [packet("failed")])).toBe(false);
    expect(isHelixCapabilityItineraryFamilyObserved("docs_viewer", [packet("succeeded")])).toBe(true);
  });

  it("counts only successful workspace_os.status gateway packets as workspace diagnostics", () => {
    const packet = (status: string) => ({
      artifact_id: `ask:workspace-status:workstation_gateway:workspace_os.status:${status}`,
      kind: "provider_gateway_observation_packet",
      payload: {
        schema: "helix.agent_step_observation_packet.v1",
        capability_key: "workspace_os.status",
        status,
      },
    });

    expect(isHelixCapabilityItineraryFamilyObserved("workspace_diagnostic", [packet("failed")])).toBe(false);
    expect(isHelixCapabilityItineraryFamilyObserved("workspace_diagnostic", [packet("succeeded")])).toBe(true);
  });

  it("counts only successful Image Lens gateway packets as visual capture observations", () => {
    const packet = (status: string) => ({
      artifact_id: `ask:image-lens-status:workstation_gateway:visual_analysis.inspect_image_region:${status}`,
      kind: "provider_gateway_observation_packet",
      payload: {
        schema: "helix.agent_step_observation_packet.v1",
        capability_key: "visual_analysis.inspect_image_region",
        status,
      },
    });

    expect(isHelixCapabilityItineraryFamilyObserved("visual_capture", [packet("failed")])).toBe(false);
    expect(isHelixCapabilityItineraryFamilyObserved("visual_capture", [packet("succeeded")])).toBe(true);
  });

  it("counts only successful Minecraft gateway packets as live-environment observations", () => {
    const packet = (status: string) => ({
      artifact_id: `ask:minecraft-inventory:workstation_gateway:${status}`,
      kind: "provider_gateway_observation_packet",
      payload: {
        schema: "helix.agent_step_observation_packet.v1",
        capability_key: "com.casimirbot.minecraft.inventory.check",
        status,
      },
    });

    expect(isHelixCapabilityItineraryFamilyObserved("live_environment", [packet("failed")]))
      .toBe(false);
    expect(isHelixCapabilityItineraryFamilyObserved("live_environment", [packet("succeeded")]))
      .toBe(true);
  });

  it("counts only successful provider-neutral environment gateway packets as live-environment observations", () => {
    const packet = (status: string) => ({
      artifact_id: `ask:g6-role-inspect:workstation_gateway:${status}`,
      kind: "provider_gateway_observation_packet",
      payload: {
        schema: "helix.agent_step_observation_packet.v1",
        capability_key: "com.casimirbot.environment.reasoning_role.inspect",
        status,
      },
    });

    expect(isHelixCapabilityItineraryFamilyObserved("live_environment", [packet("failed")]))
      .toBe(false);
    expect(isHelixCapabilityItineraryFamilyObserved("live_environment", [packet("succeeded")]))
      .toBe(true);
  });

  it("creates ordered compound subgoals for workspace status then calculator", () => {
    const itinerary = buildHelixCapabilityItinerary({
      turnId: "ask:workspace-then-calculator",
      promptText:
        "Use workspace_os.status to inspect workstation status, then call scientific-calculator.solve_expression with this exact expression: 14*23+8.",
      toolCallAdmissionDecision: {
        ...scholarlyAdmission("ask:workspace-then-calculator"),
        source_target: "workspace_diagnostic",
        admitted_tool_families: ["workspace_diagnostic", "calculator", "workstation_action"],
      },
      availableCapabilities: availableCapabilities([
        "workspace_os.status",
        "scientific-calculator.solve_expression",
      ]),
    });

    expect(itinerary.prompt_shape).toBe("compound_tool");
    expect(itinerary.compound_capability_contract).toBeTruthy();
    const subgoals = (itinerary.compound_capability_contract?.subgoals ?? []) as Array<Record<string, unknown>>;
    expect(subgoals.map((subgoal) => subgoal.requested_capability)).toEqual([
      "workspace_os.status",
      "scientific-calculator.solve_expression",
    ]);
    expect(subgoals[1]?.args_hint).toEqual({
      latex: "14*23+8",
      expression: "14*23+8",
    });
    expect(itinerary.terminal_success_criteria.required_capabilities).toEqual([
      "workspace_os.status",
      "scientific-calculator.solve_expression",
    ]);
  });

  it("extracts only the calculator expression from a docs-locate compound prompt", () => {
    const itinerary = buildHelixCapabilityItinerary({
      turnId: "ask:docs-then-calculator",
      promptText:
        "Use docs-viewer.locate_in_doc to cite the claim in the active document, then run scientific-calculator.solve_expression with this exact expression: 19+23.",
      toolCallAdmissionDecision: {
        ...scholarlyAdmission("ask:docs-then-calculator"),
        source_target: "docs_viewer",
        admitted_tool_families: ["docs_viewer", "calculator", "workstation_action"],
      },
      availableCapabilities: availableCapabilities([
        "docs-viewer.locate_in_doc",
        "scientific-calculator.solve_expression",
      ]),
    });

    const subgoals = (itinerary.compound_capability_contract?.subgoals ?? []) as Array<Record<string, unknown>>;
    expect(subgoals.map((subgoal) => subgoal.requested_capability)).toEqual([
      "docs-viewer.locate_in_doc",
      "scientific-calculator.solve_expression",
    ]);
    expect(subgoals[1]?.args_hint).toEqual({
      latex: "19+23",
      expression: "19+23",
    });
  });

  it("reconciles runtime-proven docs location artifacts into compound subgoal progress", () => {
    const turnId = "ask:docs-runtime-observation-reconcile";
    const itinerary = buildHelixCapabilityItinerary({
      turnId,
      promptText:
        "Use docs-viewer.locate_in_doc to locate the rule of thumb in docs/helix-ask-codex-loop-discipline.md, then call scientific-calculator.solve_expression with expression 2 + 2.",
      toolCallAdmissionDecision: {
        ...scholarlyAdmission(turnId),
        source_target: "docs_viewer",
        admitted_tool_families: ["docs_viewer", "calculator", "workstation_action"],
      },
      availableCapabilities: availableCapabilities([
        "docs-viewer.locate_in_doc",
        "scientific-calculator.solve_expression",
      ]),
    });
    const subgoals = (itinerary.compound_capability_contract?.subgoals ?? []) as Array<Record<string, unknown>>;
    const docsSubgoalId = String(subgoals[0]?.subgoal_id);
    const calculatorSubgoalId = String(subgoals[1]?.subgoal_id);

    const state = buildHelixCapabilityItineraryExecutionState({
      capabilityItinerary: itinerary,
      artifacts: [
        {
          artifact_id: `${turnId}:runtime_tool_call:2:docs`,
          kind: "runtime_tool_call",
          payload: {
            capability_key: "docs.search",
            call_id: `${turnId}:runtime_tool_call:2:docs`,
            args: {
              query: "rule of thumb",
              path: "docs/helix-ask-codex-loop-discipline.md",
            },
          },
        },
        {
          artifact_id: `${turnId}:runtime_tool_call:2:docs:runtime_tool_call_validation`,
          kind: "runtime_tool_call_validation",
          payload: {
            capability_key: "docs.search",
            call_id: `${turnId}:runtime_tool_call:2:docs`,
            valid: true,
            errors: [],
          },
        },
        {
          artifact_id: `${turnId}:agent_runtime_2_docs_viewer_locate_in_doc:doc_location_matches:1`,
          kind: "doc_location_matches",
          payload: {
            kind: "doc_location_matches",
          },
        },
      ],
    });

    const docsEntry = state.compound_subgoal_ledger.find((entry) => entry.subgoal_id === docsSubgoalId);
    const calculatorEntry = state.compound_subgoal_ledger.find((entry) => entry.subgoal_id === calculatorSubgoalId);
    expect(docsEntry).toMatchObject({
      requested_capability: "docs-viewer.locate_in_doc",
      selected_capability: "docs.search",
      executed_capability: "docs.search",
      observation_kind: "doc_location_matches",
      observation_ref: `${turnId}:agent_runtime_2_docs_viewer_locate_in_doc:doc_location_matches:1`,
      observation_provenance: "runtime_docs_location_observation",
      satisfaction: "satisfied",
      rail_status: "complete",
      rail_failure_code: null,
    });
    expect(calculatorEntry).toMatchObject({
      requested_capability: "scientific-calculator.solve_expression",
      satisfaction: "pending",
      rail_status: "pending",
      bound_input_refs: expect.arrayContaining([
        expect.objectContaining({
          from_subgoal_id: docsSubgoalId,
          from_capability: "docs-viewer.locate_in_doc",
          ref: `${turnId}:agent_runtime_2_docs_viewer_locate_in_doc:doc_location_matches:1`,
        }),
      ]),
      unresolved_input_bindings: [],
    });
    expect(state.missing_compound_subgoal_ids).toEqual([calculatorSubgoalId]);
    expect(state.missing_required_capabilities).toEqual(["scientific-calculator.solve_expression"]);
  });

  it("accepts a concrete location artifact as the observation from docs.search", () => {
    const turnId = "ask:docs-search-location-observation";
    const itinerary = {
      schema: "helix.capability_itinerary.v1",
      turn_id: turnId,
      terminal_success_criteria: {
        required_observation_families: ["docs_viewer"],
        requires_post_observation_synthesis: true,
      },
      compound_capability_contract: {
        subgoals: [
          {
            subgoal_id: `${turnId}:docs-search`,
            order: 1,
            requested_capability: "docs.search",
            runtime_capability: "docs.search",
            required_observation_kinds: ["doc_search_results"],
            produced_affordance_kinds: ["doc_search_results"],
            mandatory: true,
          },
        ],
      },
    };

    const state = buildHelixCapabilityItineraryExecutionState({
      capabilityItinerary: itinerary,
      artifacts: [
        {
          artifact_id: `${turnId}:runtime:docs-search`,
          kind: "doc_location_matches",
          capability_key: "docs.search",
          payload: {
            status: "located",
            match_count: 1,
            matches: [{ path: "docs/research/nhm2-current-status-whitepaper.md" }],
          },
        },
      ],
    });

    expect(state.compound_subgoal_ledger[0]).toMatchObject({
      requested_capability: "docs.search",
      executed_capability: "docs.search",
      observation_kind: "doc_location_matches",
      satisfaction: "satisfied",
      rail_status: "complete",
      rail_failure_code: null,
    });
    expect(state.missing_compound_subgoal_ids).toEqual([]);
    expect(state.missing_observation_families).toEqual([]);
    expect(state.complete).toBe(true);
  });

  it("keeps research, theory reflection, and calculator subgoals in order", () => {
    const promptText =
      "Use internet_search.web_research to find a cited research-paper source for the Alcubierre metric or warp-drive energy estimates. " +
      "Then use helix_ask.reflect_theory_context to connect the cited source to the Helix Ask rule that receipts are observations before terminal authority. " +
      "Finally run scientific-calculator.solve_expression with this exact expression: (9+3)*7-25. " +
      "Answer by explaining the citation-to-calculation connection and give the numeric result.";
    const itinerary = buildHelixCapabilityItinerary({
      turnId: "ask:research-reflection-calculator",
      promptText,
      toolCallAdmissionDecision: {
        ...scholarlyAdmission("ask:research-reflection-calculator"),
        source_target: "internet_search",
        admitted_tool_families: ["internet_search", "theory_locator", "calculator", "workstation_action"],
      },
      availableCapabilities: availableCapabilities([
        HELIX_INTERNET_SEARCH_CAPABILITY,
        "helix_ask.reflect_theory_context",
        "scientific-calculator.solve_expression",
      ]),
    });

    expect(itinerary.prompt_shape).toBe("compound_tool");
    const subgoals = (itinerary.compound_capability_contract?.subgoals ?? []) as Array<Record<string, unknown>>;
    expect(subgoals.map((subgoal) => subgoal.requested_capability)).toEqual([
      "internet_search.web_research",
      "helix_ask.reflect_theory_context",
      "scientific-calculator.solve_expression",
    ]);
    const reflectionArgs = subgoals[1]?.args_hint as Record<string, unknown>;
    expect(reflectionArgs).toEqual(expect.objectContaining({
      build_explanation_plan: true,
      sync_panel: true,
      panel_overlay_mode: "live_answer_context",
      open_panel: false,
    }));
    expect(reflectionArgs.prompt).toEqual(expect.stringContaining("receipts are observations before terminal authority"));
    expect(String(reflectionArgs.prompt)).not.toContain("scientific-calculator.solve_expression");
    expect(subgoals[1]?.depends_on_subgoal_ids).toEqual([subgoals[0]?.subgoal_id]);
    expect(subgoals[1]?.input_bindings).toEqual([
      expect.objectContaining({
        arg_name: "source_ref",
        binding_kind: "source_ref",
        from_subgoal_id: subgoals[0]?.subgoal_id,
        from_capability: "internet_search.web_research",
        required_observation_kinds: ["internet_search_observation"],
        required: true,
      }),
    ]);
    expect(subgoals[2]?.args_hint).toEqual({
      latex: "(9+3)*7-25",
      expression: "(9+3)*7-25",
    });
    expect(itinerary.terminal_success_criteria.required_capabilities).toEqual([
      "internet_search.web_research",
      "helix_ask.reflect_theory_context",
      "scientific-calculator.solve_expression",
    ]);
    expect(itinerary.terminal_success_criteria.forbidden_terminal_artifact_kinds).toContain("tool_receipt");
  });

  it("binds prior research observations into the theory reflection subgoal rail", () => {
    const turnId = "ask:research-reflection-binding";
    const promptText =
      "Use internet_search.web_research to find a cited research-paper source for the Alcubierre metric. " +
      "Then use helix_ask.reflect_theory_context to connect the cited source to receipts as observations.";
    const itinerary = buildHelixCapabilityItinerary({
      turnId,
      promptText,
      toolCallAdmissionDecision: {
        ...scholarlyAdmission(turnId),
        source_target: "internet_search",
        admitted_tool_families: ["internet_search", "theory_locator"],
      },
      availableCapabilities: availableCapabilities([
        HELIX_INTERNET_SEARCH_CAPABILITY,
        "helix_ask.reflect_theory_context",
      ]),
    });
    const subgoals = (itinerary.compound_capability_contract?.subgoals ?? []) as Array<Record<string, unknown>>;
    const researchSubgoalId = String(subgoals[0]?.subgoal_id);
    const reflectionSubgoalId = String(subgoals[1]?.subgoal_id);
    const complete = buildHelixCapabilityItineraryExecutionState({
      capabilityItinerary: itinerary,
      artifacts: [
        {
          artifact_id: "obs:web-search-call",
          kind: "runtime_tool_call",
          payload: {
            capability_key: HELIX_INTERNET_SEARCH_CAPABILITY,
            compound_subgoal_id: researchSubgoalId,
            args: { query: "Alcubierre metric energy estimate" },
          },
        },
        {
          artifact_id: "obs:web-search-runtime",
          kind: "runtime_tool_observation",
          payload: {
            capability_key: HELIX_INTERNET_SEARCH_CAPABILITY,
            compound_subgoal_id: researchSubgoalId,
            status: "completed",
          },
        },
        {
          artifact_id: "obs:web-search",
          kind: "internet_search_observation",
          payload: {
            schema: "helix.internet_search_observation.v1",
            capability_key: HELIX_INTERNET_SEARCH_CAPABILITY,
            compound_subgoal_id: researchSubgoalId,
            source_ref: "paper:alcubierre-1994",
            evidence_refs: ["paper:alcubierre-1994"],
          },
        },
        {
          artifact_id: "obs:reflection-call",
          kind: "runtime_tool_call",
          payload: {
            capability_key: "helix_ask.reflect_theory_context",
            compound_subgoal_id: reflectionSubgoalId,
            args: {
              prompt: promptText,
              build_explanation_plan: true,
            },
          },
        },
        {
          artifact_id: "obs:reflection-runtime",
          kind: "runtime_tool_observation",
          payload: {
            capability_key: "helix_ask.reflect_theory_context",
            compound_subgoal_id: reflectionSubgoalId,
            status: "completed",
          },
        },
        {
          artifact_id: "obs:reflection",
          kind: "theory_context_reflection",
          payload: {
            schema: "helix.theory_context_reflection.v1",
            capability_key: "helix_ask.reflect_theory_context",
            compound_subgoal_id: reflectionSubgoalId,
            evidence_refs: ["obs:web-search"],
          },
        },
      ],
    });

    const reflectionEntry = complete.compound_subgoal_ledger.find((entry) =>
      entry.requested_capability === "helix_ask.reflect_theory_context"
    );
    expect(reflectionEntry).toMatchObject({
      satisfaction: "satisfied",
      rail_status: "complete",
      unresolved_input_bindings: [],
    });
    expect(reflectionEntry?.bound_input_refs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        from_subgoal_id: researchSubgoalId,
        from_capability: "internet_search.web_research",
        ref: "obs:web-search",
      }),
    ]));
  });

  it("does not bind a prior subgoal from runtime progress without an observation artifact", () => {
    const turnId = "ask:research-reflection-binding-without-observation";
    const promptText =
      "Use internet_search.web_research to find a cited research-paper source for the Alcubierre metric. " +
      "Then use helix_ask.reflect_theory_context to connect the cited source to receipts as observations.";
    const itinerary = buildHelixCapabilityItinerary({
      turnId,
      promptText,
      toolCallAdmissionDecision: {
        ...scholarlyAdmission(turnId),
        source_target: "internet_search",
        admitted_tool_families: ["internet_search", "theory_locator"],
      },
      availableCapabilities: availableCapabilities([
        HELIX_INTERNET_SEARCH_CAPABILITY,
        "helix_ask.reflect_theory_context",
      ]),
    });
    const subgoals = (itinerary.compound_capability_contract?.subgoals ?? []) as Array<Record<string, unknown>>;
    const researchSubgoalId = String(subgoals[0]?.subgoal_id);
    const reflectionSubgoalId = String(subgoals[1]?.subgoal_id);
    const state = buildHelixCapabilityItineraryExecutionState({
      capabilityItinerary: itinerary,
      artifacts: [
        {
          artifact_id: "obs:web-search-call",
          kind: "runtime_tool_call",
          payload: {
            capability_key: HELIX_INTERNET_SEARCH_CAPABILITY,
            compound_subgoal_id: researchSubgoalId,
            args: { query: "Alcubierre metric energy estimate" },
          },
        },
        {
          artifact_id: "obs:web-search-runtime",
          kind: "runtime_tool_observation",
          payload: {
            capability_key: HELIX_INTERNET_SEARCH_CAPABILITY,
            compound_subgoal_id: researchSubgoalId,
            status: "completed",
          },
        },
        {
          artifact_id: "obs:reflection-call",
          kind: "runtime_tool_call",
          payload: {
            capability_key: "helix_ask.reflect_theory_context",
            compound_subgoal_id: reflectionSubgoalId,
            args: {
              prompt: promptText,
              build_explanation_plan: true,
            },
          },
        },
        {
          artifact_id: "obs:reflection-runtime",
          kind: "runtime_tool_observation",
          payload: {
            capability_key: "helix_ask.reflect_theory_context",
            compound_subgoal_id: reflectionSubgoalId,
            status: "completed",
          },
        },
        {
          artifact_id: "obs:reflection",
          kind: "theory_context_reflection",
          payload: {
            schema: "helix.theory_context_reflection.v1",
            capability_key: "helix_ask.reflect_theory_context",
            compound_subgoal_id: reflectionSubgoalId,
            evidence_refs: ["obs:web-search"],
          },
        },
      ],
    });

    const researchEntry = state.compound_subgoal_ledger.find((entry) =>
      entry.requested_capability === "internet_search.web_research"
    );
    const reflectionEntry = state.compound_subgoal_ledger.find((entry) =>
      entry.requested_capability === "helix_ask.reflect_theory_context"
    );
    expect(researchEntry).toMatchObject({
      satisfaction: "failed",
      rail_status: "fail_closed",
      rail_failure_code: "subgoal_observation_missing",
      observation_ref: null,
    });
    expect(reflectionEntry).toMatchObject({
      satisfaction: "failed",
      rail_status: "fail_closed",
      rail_failure_code: "input_binding_missing",
      bound_input_refs: [],
    });
    expect(state).toMatchObject({
      complete: false,
      missing_compound_subgoal_ids: expect.arrayContaining([researchSubgoalId, reflectionSubgoalId]),
      missing_required_capabilities: expect.arrayContaining([
        "internet_search.web_research",
        "helix_ask.reflect_theory_context",
      ]),
    });
  });

  it("binds prior repo and docs observations into a later reflection subgoal rail", () => {
    const turnId = "ask:repo-docs-reflection-binding";
    const promptText =
      "Use repo-code.search_concept to find terminal authority enforcement, " +
      "then use docs-viewer.locate_in_doc to locate the same rule in the active document, " +
      "then use helix_ask.reflect_theory_context to compare the repo and doc evidence.";
    const itinerary = buildHelixCapabilityItinerary({
      turnId,
      promptText,
      toolCallAdmissionDecision: {
        ...scholarlyAdmission(turnId),
        source_target: "runtime_evidence",
        admitted_tool_families: ["repo_code", "docs_viewer", "theory_locator"],
      },
      availableCapabilities: availableCapabilities([
        "repo-code.search_concept",
        "docs-viewer.locate_in_doc",
        "helix_ask.reflect_theory_context",
      ]),
    });
    const subgoals = (itinerary.compound_capability_contract?.subgoals ?? []) as Array<Record<string, unknown>>;
    const repoSubgoalId = String(subgoals[0]?.subgoal_id);
    const docsSubgoalId = String(subgoals[1]?.subgoal_id);
    const reflectionSubgoalId = String(subgoals[2]?.subgoal_id);

    expect(subgoals.map((subgoal) => subgoal.requested_capability)).toEqual([
      "repo-code.search_concept",
      "docs-viewer.locate_in_doc",
      "helix_ask.reflect_theory_context",
    ]);
    expect(subgoals[2]?.depends_on_subgoal_ids).toEqual([repoSubgoalId, docsSubgoalId]);
    expect(subgoals[2]?.input_bindings).toEqual([
      expect.objectContaining({
        arg_name: "source_refs",
        binding_kind: "source_ref",
        from_subgoal_id: repoSubgoalId,
        from_capability: "repo-code.search_concept",
        required_observation_kinds: ["repo_code_evidence_observation", "repo_evidence_relevance_gate"],
      }),
      expect.objectContaining({
        arg_name: "source_refs",
        binding_kind: "source_ref",
        from_subgoal_id: docsSubgoalId,
        from_capability: "docs-viewer.locate_in_doc",
        required_observation_kinds: ["doc_location_result", "doc_location_matches", "doc_evidence_location"],
      }),
    ]);

    const complete = buildHelixCapabilityItineraryExecutionState({
      capabilityItinerary: itinerary,
      artifacts: [
        {
          artifact_id: "obs:repo-call",
          kind: "runtime_tool_call",
          payload: {
            capability_key: "repo-code.search_concept",
            compound_subgoal_id: repoSubgoalId,
            args: { query: "terminal authority enforcement" },
          },
        },
        {
          artifact_id: "obs:repo-runtime",
          kind: "runtime_tool_observation",
          payload: {
            capability_key: "repo-code.search_concept",
            compound_subgoal_id: repoSubgoalId,
            status: "completed",
          },
        },
        {
          artifact_id: "obs:repo-evidence",
          kind: "repo_code_evidence_observation",
          payload: {
            schema: "helix.repo_code_evidence_observation.v1",
            capability_key: "repo-code.search_concept",
            compound_subgoal_id: repoSubgoalId,
            evidence_refs: ["repo:file:terminal-authority-single-writer.ts"],
          },
        },
        {
          artifact_id: "obs:docs-call",
          kind: "runtime_tool_call",
          payload: {
            capability_key: "docs-viewer.locate_in_doc",
            compound_subgoal_id: docsSubgoalId,
            args: { query: "terminal authority" },
          },
        },
        {
          artifact_id: "obs:docs-runtime",
          kind: "runtime_tool_observation",
          payload: {
            capability_key: "docs-viewer.locate_in_doc",
            compound_subgoal_id: docsSubgoalId,
            status: "completed",
          },
        },
        {
          artifact_id: "obs:doc-location",
          kind: "doc_location_matches",
          payload: {
            schema: "helix.doc_location_matches.v1",
            capability_key: "docs-viewer.locate_in_doc",
            compound_subgoal_id: docsSubgoalId,
            evidence_refs: ["docs/helix-ask-codex-loop-discipline.md#terminal-authority"],
          },
        },
        {
          artifact_id: "obs:reflection-call",
          kind: "runtime_tool_call",
          payload: {
            capability_key: "helix_ask.reflect_theory_context",
            compound_subgoal_id: reflectionSubgoalId,
            args: {
              prompt: promptText,
              source_refs: ["obs:repo-evidence", "obs:doc-location"],
            },
          },
        },
        {
          artifact_id: "obs:reflection-runtime",
          kind: "runtime_tool_observation",
          payload: {
            capability_key: "helix_ask.reflect_theory_context",
            compound_subgoal_id: reflectionSubgoalId,
            status: "completed",
          },
        },
        {
          artifact_id: "obs:reflection",
          kind: "theory_context_reflection",
          payload: {
            schema: "helix.theory_context_reflection.v1",
            capability_key: "helix_ask.reflect_theory_context",
            compound_subgoal_id: reflectionSubgoalId,
            evidence_refs: ["obs:repo-evidence", "obs:doc-location"],
          },
        },
      ],
    });

    const reflectionEntry = complete.compound_subgoal_ledger.find((entry) =>
      entry.requested_capability === "helix_ask.reflect_theory_context"
    );
    expect(reflectionEntry).toMatchObject({
      satisfaction: "satisfied",
      rail_status: "complete",
      unresolved_input_bindings: [],
    });
    expect(reflectionEntry?.bound_input_refs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        from_subgoal_id: repoSubgoalId,
        from_capability: "repo-code.search_concept",
        ref: "obs:repo-evidence",
      }),
      expect.objectContaining({
        from_subgoal_id: docsSubgoalId,
        from_capability: "docs-viewer.locate_in_doc",
        ref: "obs:doc-location",
      }),
    ]));
  });

  it("keeps civilization scenario and bounds reflection subgoals bound in order", () => {
    const promptText =
      "Call helix_ask.build_civilization_scenario_frame for a long-range settlement scenario, " +
      "then call helix_ask.reflect_civilization_bounds to reflect collaboration and falsification bounds.";
    const itinerary = buildHelixCapabilityItinerary({
      turnId: "ask:civilization-frame-then-bounds",
      promptText,
      toolCallAdmissionDecision: {
        ...scholarlyAdmission("ask:civilization-frame-then-bounds"),
        source_target: "workspace_action",
        admitted_tool_families: ["workstation_action"],
      },
      availableCapabilities: availableCapabilities([
        "helix_ask.build_civilization_scenario_frame",
        "helix_ask.reflect_civilization_bounds",
      ]),
    });
    const subgoals = (itinerary.compound_capability_contract?.subgoals ?? []) as Array<Record<string, unknown>>;

    expect(subgoals.map((subgoal) => subgoal.requested_capability)).toEqual([
      "helix_ask.build_civilization_scenario_frame",
      "helix_ask.reflect_civilization_bounds",
    ]);
    const scenarioArgs = subgoals[0]?.args_hint as Record<string, unknown>;
    expect(scenarioArgs).toEqual(expect.objectContaining({
      refs: ["helix-ask:current-turn"],
      options: expect.objectContaining({
        allowFictional: true,
        allowHistorical: true,
        includeNeedleScenarioFallback: true,
      }),
    }));
    expect(scenarioArgs.prompt).toEqual(expect.stringContaining("long-range settlement scenario"));
    const boundsArgs = subgoals[1]?.args_hint as Record<string, unknown>;
    expect(boundsArgs).toEqual(expect.objectContaining({
      scenarioFrameRef: "step:build_civilization_scenario_frame",
      refs: ["helix-ask:current-turn"],
      options: expect.objectContaining({
        includeBridgeContext: true,
        includeCollaborationBounds: true,
        includeFalsificationHooks: true,
      }),
    }));
    expect(boundsArgs.prompt).toEqual(expect.stringContaining("collaboration and falsification bounds"));
    expect(subgoals[1]?.depends_on_subgoal_ids).toEqual([subgoals[0]?.subgoal_id]);
    expect(subgoals[1]?.input_bindings).toEqual([
      expect.objectContaining({
        arg_name: "scenarioFrameRef",
        binding_kind: "source_ref",
        from_subgoal_id: subgoals[0]?.subgoal_id,
        from_capability: "helix_ask.build_civilization_scenario_frame",
        required_observation_kinds: [
          "civilization_scenario_frame/v1",
          "helix_civilization_scenario_frame_tool_result",
        ],
      }),
    ]);
  });

  it("creates ordered compound subgoals for catalog/workspace, repo/docs, and visual/calculator prompts", () => {
    const cases = [
      {
        turnId: "ask:catalog-then-workspace",
        promptText:
          "Call helix_ask.inspect_capability_catalog, then use workspace_os.status to inspect workstation status.",
        admittedFamilies: ["capability_catalog", "runtime_evidence", "workspace_diagnostic"],
        available: ["helix_ask.inspect_capability_catalog", "workspace_os.status"],
        expectedRequested: ["helix_ask.inspect_capability_catalog", "workspace_os.status"],
        expectedRuntime: ["helix_ask.inspect_capability_catalog", "workspace_os.status"],
      },
      {
        turnId: "ask:repo-plus-docs",
        promptText:
          "Use repo-code.search_concept to find where terminal authority is enforced, plus docs-viewer.locate_in_doc to locate the same rule in the active document.",
        admittedFamilies: ["repo_code", "docs_viewer"],
        available: ["repo-code.search_concept", "docs-viewer.locate_in_doc"],
        expectedRequested: ["repo-code.search_concept", "docs-viewer.locate_in_doc"],
        expectedRuntime: ["repo.search", "docs.search"],
      },
      {
        turnId: "ask:visual-then-calculator",
        promptText:
          "Use situation-room.describe_visual_capture, then run scientific-calculator.solve_expression with this exact expression: 5*9.",
        admittedFamilies: ["situation_run", "calculator", "workstation_action"],
        available: ["situation-room.describe_visual_capture", "scientific-calculator.solve_expression"],
        expectedRequested: ["image_lens.inspect", "scientific-calculator.solve_expression"],
        expectedRuntime: ["situation-room.describe_visual_capture", "scientific-calculator.solve_expression"],
      },
    ];

    for (const testCase of cases) {
      const itinerary = buildHelixCapabilityItinerary({
        turnId: testCase.turnId,
        promptText: testCase.promptText,
        toolCallAdmissionDecision: {
          ...scholarlyAdmission(testCase.turnId),
          source_target: "runtime_evidence",
          admitted_tool_families: testCase.admittedFamilies,
        },
        availableCapabilities: availableCapabilities(testCase.available),
      });
      const subgoals = (itinerary.compound_capability_contract?.subgoals ?? []) as Array<Record<string, unknown>>;

      expect(itinerary.prompt_shape).toBe("compound_tool");
      expect(subgoals.map((subgoal) => subgoal.requested_capability)).toEqual(testCase.expectedRequested);
      expect(subgoals.map((subgoal) => subgoal.runtime_capability)).toEqual(testCase.expectedRuntime);
      expect(itinerary.terminal_success_criteria.required_capabilities).toEqual(testCase.expectedRequested);
    }
  });

  it("keeps terminal incomplete until every compound subgoal has runtime-backed observation", () => {
    const itinerary = buildHelixCapabilityItinerary({
      turnId: "ask:compound-ledger",
      promptText:
        "Use workspace_os.status to inspect workstation status, then call scientific-calculator.solve_expression with this exact expression: 2+2.",
      toolCallAdmissionDecision: {
        ...scholarlyAdmission("ask:compound-ledger"),
        source_target: "workspace_diagnostic",
        admitted_tool_families: ["workspace_diagnostic", "calculator", "workstation_action"],
      },
      availableCapabilities: availableCapabilities([
        "workspace_os.status",
        "scientific-calculator.solve_expression",
      ]),
    });

    const partial = buildHelixCapabilityItineraryExecutionState({
      capabilityItinerary: itinerary,
      artifacts: [
        {
          artifact_id: "ask:compound-ledger:runtime_tool_call:1",
          kind: "runtime_tool_call",
          payload: {
            capability_key: "workspace_os.status",
            args: {},
          },
        },
        {
          artifact_id: "ask:compound-ledger:runtime_tool_call:1:runtime_tool_observation",
          kind: "runtime_tool_observation",
          payload: {
            capability_key: "workspace_os.status",
            status: "completed",
          },
        },
        {
          artifact_id: "ask:compound-ledger:workspace_status",
          kind: "workspace_os_status_observation",
          payload: {
            schema: "helix.workspace_os_status_observation.v1",
          },
        },
      ],
    });

    expect(partial.complete).toBe(false);
    expect(partial.compound_subgoal_ledger.map((entry) => entry.satisfaction)).toEqual([
      "satisfied",
      "pending",
    ]);
    expect(partial.next_missing_subgoal_id).toContain("scientific-calculator");
    expect(partial.missing_required_capabilities).toEqual([
      "scientific-calculator.solve_expression",
    ]);

    const complete = buildHelixCapabilityItineraryExecutionState({
      capabilityItinerary: itinerary,
      artifacts: [
        {
          artifact_id: "ask:compound-ledger:runtime_tool_call:1",
          kind: "runtime_tool_call",
          payload: {
            capability_key: "workspace_os.status",
            args: {},
          },
        },
        {
          artifact_id: "ask:compound-ledger:runtime_tool_call:1:runtime_tool_observation",
          kind: "runtime_tool_observation",
          payload: {
            capability_key: "workspace_os.status",
            status: "completed",
          },
        },
        {
          artifact_id: "ask:compound-ledger:workspace_status",
          kind: "workspace_os_status_observation",
          payload: {
            schema: "helix.workspace_os_status_observation.v1",
          },
        },
        {
          artifact_id: "ask:compound-ledger:runtime_tool_call:2",
          kind: "runtime_tool_call",
          payload: {
            capability_key: "scientific-calculator.solve_expression",
            args: { latex: "2+2", expression: "2+2" },
          },
        },
        {
          artifact_id: "ask:compound-ledger:runtime_tool_call:2:runtime_tool_observation",
          kind: "runtime_tool_observation",
          payload: {
            capability_key: "scientific-calculator.solve_expression",
            status: "completed",
          },
        },
        {
          artifact_id: "ask:compound-ledger:calculator_receipt",
          kind: "calculator_receipt",
          payload: {
            schema: "helix.calculator_receipt.v1",
          },
        },
      ],
    });

    expect(complete.complete).toBe(true);
    expect(complete.compound_subgoal_ledger.map((entry) => entry.satisfaction)).toEqual([
      "satisfied",
      "satisfied",
    ]);
  });

  it("does not satisfy a compound subgoal from another subgoal's shared observation kind", () => {
    const itinerary = buildHelixCapabilityItinerary({
      turnId: "ask:compound-shared-observation-kind",
      promptText:
        "Use workspace_os.status to inspect workstation status, then call scientific-calculator.solve_expression with this exact expression: 2+2.",
      toolCallAdmissionDecision: {
        ...scholarlyAdmission("ask:compound-shared-observation-kind"),
        source_target: "workspace_diagnostic",
        admitted_tool_families: ["workspace_diagnostic", "calculator", "workstation_action"],
      },
      availableCapabilities: availableCapabilities([
        "workspace_os.status",
        "scientific-calculator.solve_expression",
      ]),
    });

    const artifacts = [
      {
        artifact_id: "ask:compound-shared-observation-kind:runtime_tool_call:1",
        kind: "runtime_tool_call",
        payload: {
          capability_key: "workspace_os.status",
          args: {},
        },
      },
      {
        artifact_id: "ask:compound-shared-observation-kind:runtime_tool_call:1:runtime_tool_observation",
        kind: "runtime_tool_observation",
        payload: {
          capability_key: "workspace_os.status",
          status: "completed",
        },
      },
      {
        artifact_id: "ask:compound-shared-observation-kind:workspace_status",
        kind: "workspace_os_status_observation",
        payload: {
          schema: "helix.workspace_os_status_observation.v1",
        },
      },
      {
        artifact_id: "ask:compound-shared-observation-kind:workspace_tool_evaluation",
        kind: "workstation_tool_evaluation",
        payload: {
          schema: "helix.workstation_tool_evaluation.v1",
          capability_key: "workspace_os.status",
          summary: "Workspace status returned capability records.",
        },
      },
      {
        artifact_id: "ask:compound-shared-observation-kind:runtime_tool_call:2",
        kind: "runtime_tool_call",
        payload: {
          capability_key: "scientific-calculator.solve_expression",
          args: { latex: "2+2", expression: "2+2" },
        },
      },
      {
        artifact_id: "ask:compound-shared-observation-kind:runtime_tool_call:2:runtime_tool_observation",
        kind: "runtime_tool_observation",
        payload: {
          capability_key: "scientific-calculator.solve_expression",
          status: "completed",
        },
      },
    ];

    const mismatched = buildHelixCapabilityItineraryExecutionState({
      capabilityItinerary: itinerary,
      artifacts,
    });
    const mismatchedCalculatorEntry = mismatched.compound_subgoal_ledger.find((entry) =>
      entry.requested_capability === "scientific-calculator.solve_expression"
    );

    expect(mismatchedCalculatorEntry).toMatchObject({
      executed_capability: "scientific-calculator.solve_expression",
      observation_ref: null,
      satisfaction: "failed",
      rail_failure_code: "subgoal_observation_missing",
    });
    expect(mismatched.complete).toBe(false);
    expect(mismatched.missing_required_capabilities).toEqual([
      "scientific-calculator.solve_expression",
    ]);

    const matched = buildHelixCapabilityItineraryExecutionState({
      capabilityItinerary: itinerary,
      artifacts: [
        ...artifacts,
        {
          artifact_id: "ask:compound-shared-observation-kind:calculator_tool_evaluation",
          kind: "workstation_tool_evaluation",
          payload: {
            schema: "helix.workstation_tool_evaluation.v1",
            capability_key: "scientific-calculator.solve_expression",
            summary: "Calculator result: 4.",
          },
        },
      ],
    });
    const matchedCalculatorEntry = matched.compound_subgoal_ledger.find((entry) =>
      entry.requested_capability === "scientific-calculator.solve_expression"
    );

    expect(matchedCalculatorEntry).toMatchObject({
      executed_capability: "scientific-calculator.solve_expression",
      observation_ref: "ask:compound-shared-observation-kind:calculator_tool_evaluation",
      satisfaction: "satisfied",
      rail_failure_code: null,
    });
    expect(matched.complete).toBe(true);
  });

  it("links authorized calculator receipts to compound subgoals by matching expression when legacy subgoal id is generic", () => {
    const itinerary = buildHelixCapabilityItinerary({
      turnId: "ask:workspace-calculator-legacy-receipt",
      promptText:
        "Use workspace_os.status to inspect workstation status, then call scientific-calculator.solve_expression with this exact expression: 14*23+8.",
      toolCallAdmissionDecision: {
        ...scholarlyAdmission("ask:workspace-calculator-legacy-receipt"),
        source_target: "workspace_diagnostic",
        admitted_tool_families: ["workspace_diagnostic", "calculator", "workstation_action"],
      },
      availableCapabilities: availableCapabilities([
        "workspace_os.status",
        "scientific-calculator.solve_expression",
      ]),
    });

    const state = buildHelixCapabilityItineraryExecutionState({
      capabilityItinerary: itinerary,
      artifacts: [
        {
          artifact_id: "ask:legacy-receipt:runtime_tool_call:1",
          kind: "runtime_tool_call",
          payload: {
            capability_key: "workspace_os.status",
            args: {},
          },
        },
        {
          artifact_id: "ask:legacy-receipt:runtime_tool_call:1:runtime_tool_observation",
          kind: "runtime_tool_observation",
          payload: {
            capability_key: "workspace_os.status",
            status: "completed",
          },
        },
        {
          artifact_id: "ask:legacy-receipt:runtime_tool_call:1:workspace_os_status_observation",
          kind: "workspace_os_status_observation",
          payload: {
            capability_key: "workspace_os.status",
            status: "completed",
          },
        },
        {
          artifact_id: "ask:legacy-receipt:calculator_subgoal_receipt:calculate_expression",
          kind: "calculator_subgoal_receipt",
          payload: {
            schema: "helix.calculator_subgoal_receipt.v1",
            receipt_id: "ask:legacy-receipt:calculator_subgoal_receipt:calculate_expression",
            subgoal_id: "calculate_expression",
            expression: "14*23+8",
            result_text: "330",
            status: "completed",
            trace_source: "scientific-calculator.solve_expression",
            authorized_by_agent_step_decision: true,
            action_authorization: {
              authorizes_tool_execution: true,
              authorized_capability: "scientific-calculator.solve_expression",
            },
          },
        },
      ],
    });

    const calculatorLedgerEntry = state.compound_subgoal_ledger.find((entry) =>
      entry.requested_capability === "scientific-calculator.solve_expression"
    );
    expect(calculatorLedgerEntry).toMatchObject({
      selected_capability: "scientific-calculator.solve_expression",
      executed_capability: "scientific-calculator.solve_expression",
      observation_ref: "ask:legacy-receipt:calculator_subgoal_receipt:calculate_expression",
      satisfaction: "satisfied",
      rail_status: "complete",
      rail_failure_code: null,
    });
    expect(state.complete).toBe(true);
    expect(state.missing_required_capabilities).toEqual([]);
  });

  it("marks a compound subgoal failed when runtime validation rejects its arguments", () => {
    const itinerary = buildHelixCapabilityItinerary({
      turnId: "ask:compound-invalid-args",
      promptText:
        "Use docs-viewer.locate_in_doc to cite the claim, then call scientific-calculator.solve_expression with this exact expression: explain why receipts matter.",
      toolCallAdmissionDecision: {
        ...scholarlyAdmission("ask:compound-invalid-args"),
        source_target: "docs_viewer",
        admitted_tool_families: ["docs_viewer", "calculator", "workstation_action"],
      },
      availableCapabilities: availableCapabilities([
        "docs-viewer.locate_in_doc",
        "scientific-calculator.solve_expression",
      ]),
    });
    const calculatorSubgoal = ((itinerary.compound_capability_contract?.subgoals ?? []) as Array<Record<string, unknown>>)
      .find((subgoal) => subgoal.requested_capability === "scientific-calculator.solve_expression");

    const state = buildHelixCapabilityItineraryExecutionState({
      capabilityItinerary: itinerary,
      artifacts: [
        {
          artifact_id: "ask:compound-invalid-args:runtime_tool_call:2",
          kind: "runtime_tool_call",
          payload: {
            call_id: "ask:compound-invalid-args:runtime_tool_call:2",
            capability_key: "scientific-calculator.solve_expression",
            args: {
              latex: "Use docs-viewer.locate_in_doc to cite the claim, then call scientific-calculator.solve_expression with this exact expression: explain why receipts matter.",
              compound_subgoal_id: calculatorSubgoal?.subgoal_id,
            },
          },
        },
        {
          artifact_id: "ask:compound-invalid-args:runtime_tool_call:2:runtime_tool_call_validation",
          kind: "runtime_tool_call_validation",
          payload: {
            call_id: "ask:compound-invalid-args:runtime_tool_call:2",
            capability_key: "scientific-calculator.solve_expression",
            valid: false,
            errors: ["invalid_arg:latex_is_prose"],
          },
        },
      ],
    });

    const calculatorLedgerEntry = state.compound_subgoal_ledger.find((entry) =>
      entry.requested_capability === "scientific-calculator.solve_expression"
    );
    expect(calculatorLedgerEntry).toMatchObject({
      satisfaction: "failed",
      rail_status: "fail_closed",
      rail_failure_code: "invalid_arg:latex_is_prose",
      repair_target: "subgoal_argument_extraction",
    });
    expect(state.complete).toBe(false);
    expect(state.missing_required_capabilities).toContain("scientific-calculator.solve_expression");
  });

  it("records compound scholarly research plus theory locator criteria before execution", () => {
    const itinerary = buildHelixCapabilityItinerary({
      turnId: "ask:compound-itinerary",
      promptText:
        "Use scholarly papers and citations to research microtubule coherence, then place it on the theory badge graph with scale bands and uncertainty mode.",
      toolCallAdmissionDecision: scholarlyAdmission("ask:compound-itinerary"),
      availableCapabilities: availableCapabilities([
        HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
        "helix_ask.reflect_theory_context",
      ]),
    });

    expect(itinerary.prompt_shape).toBe("compound_tool");
    expect(itinerary.relevant_tool_families).toEqual(["scholarly_research", "theory_locator"]);
    expect(itinerary.admitted_tool_families).toEqual(["scholarly_research", "theory_locator"]);
    expect(itinerary.missing_tool_families).toEqual([]);
    expect(itinerary.planned_steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          step_id: "collect_scholarly_evidence",
          tool_family: "scholarly_research",
          status: "admitted",
          required_observation_kinds: ["scholarly_research_observation"],
        }),
        expect.objectContaining({
          tool_family: "theory_locator",
          requested_capability: "helix_ask.reflect_theory_context",
          status: "planned",
          required_observation_kinds: ["helix_theory_context_reflection_tool_receipt", "theory_context_reflection"],
        }),
      ]),
    );
    expect(itinerary.reasoning_criteria.map((criterion) => criterion.criterion_id)).toEqual([
      "research_evidence_grounding",
      "badge_graph_location_grounding",
      "compound_reentry_before_terminal",
    ]);
    expect(itinerary.terminal_success_criteria.required_observation_families).toEqual([
      "scholarly_research",
      "theory_locator",
    ]);
    expect(itinerary.terminal_success_criteria.typed_failure_codes).toEqual(
      expect.arrayContaining([
        "research_observation_missing",
        "locator_observation_missing",
        "compound_evidence_not_reentered",
      ]),
    );
    expect(itinerary.authority).toBe("planning_only");
    expect(itinerary.not_terminal).toBe(true);
    expect(itinerary.assistant_answer).toBe(false);
    expect(itinerary.raw_content_included).toBe(false);
  });

  it("keeps explicit scholarly lookup and full-text fetch subgoals with narrow args", () => {
    const itinerary = buildHelixCapabilityItinerary({
      turnId: "ask:scholarly-lookup-then-fetch",
      promptText:
        "Call scholarly-research.lookup_papers for Alcubierre metric energy estimates, then call scholarly-research.fetch_full_text paper_result_id=arxiv:warp-1994.",
      toolCallAdmissionDecision: scholarlyAdmission("ask:scholarly-lookup-then-fetch"),
      availableCapabilities: availableCapabilities([
        HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
        HELIX_SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
      ]),
    });

    expect(itinerary.prompt_shape).toBe("compound_tool");
    const subgoals = (itinerary.compound_capability_contract?.subgoals ?? []) as Array<Record<string, unknown>>;
    expect(subgoals.map((subgoal) => subgoal.requested_capability)).toEqual([
      HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
      HELIX_SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
    ]);
    expect(subgoals[0]?.args_hint).toEqual({
      query: "Alcubierre metric energy estimates",
      limit: 5,
    });
    expect(subgoals[0]?.required_args).toEqual(["query"]);
    expect(subgoals[1]?.args_hint).toEqual({
      paper_result_id: "arxiv:warp-1994",
    });
    expect(subgoals[1]?.required_args).toEqual(["paper_result_or_source"]);
    expect(subgoals[0]?.required_observation_kinds).toEqual(["scholarly_research_observation"]);
    expect(subgoals[1]?.required_observation_kinds).toEqual(["scholarly_full_text_observation"]);
    expect(itinerary.terminal_success_criteria.required_capabilities).toEqual([
      HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
      HELIX_SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
    ]);
    expect(itinerary.terminal_success_criteria.forbidden_terminal_artifact_kinds).toContain("tool_receipt");
  });

  it("preserves required argument rails in the compound subgoal ledger", () => {
    const itinerary = buildHelixCapabilityItinerary({
      turnId: "ask:compound-required-args-ledger",
      promptText:
        "Use docs-viewer.locate_in_doc to cite the claim, then call scientific-calculator.solve_expression with this exact expression: 12/3.",
      toolCallAdmissionDecision: {
        ...scholarlyAdmission("ask:compound-required-args-ledger"),
        source_target: "docs_viewer",
        admitted_tool_families: ["docs_viewer", "calculator", "workstation_action"],
      },
      availableCapabilities: availableCapabilities([
        "docs-viewer.locate_in_doc",
        "scientific-calculator.solve_expression",
      ]),
    });
    const state = buildHelixCapabilityItineraryExecutionState({
      capabilityItinerary: itinerary,
      artifacts: [],
    });

    expect(state.compound_subgoal_ledger.map((entry) => ({
      requested_capability: entry.requested_capability,
      required_args: entry.required_args,
    }))).toEqual([
      {
        requested_capability: "docs-viewer.locate_in_doc",
        required_args: ["query"],
      },
      {
        requested_capability: "scientific-calculator.solve_expression",
        required_args: ["latex"],
      },
    ]);
  });

  it("requires frontier candidate and literature-map observations for scholarly theory frontier prompts", () => {
    const itinerary = buildHelixCapabilityItinerary({
      turnId: "ask:frontier-seed-finder",
      promptText:
        "Use scholarly papers and full text to run the Theory Frontier Seed Finder on missing intermediate badges in the theory badge graph, then map extracted equations back to semantic chunks.",
      toolCallAdmissionDecision: scholarlyAdmission("ask:frontier-seed-finder"),
      availableCapabilities: availableCapabilities([
        HELIX_SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
        "helix_ask.reflect_theory_context",
      ]),
    });

    expect(itinerary.prompt_shape).toBe("compound_tool");
    expect(itinerary.relevant_tool_families).toEqual(["scholarly_research", "theory_locator"]);
    expect(itinerary.planned_steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          step_id: "collect_scholarly_evidence",
          tool_family: "scholarly_research",
          required_observation_kinds: [
            "scholarly_research_observation",
            "scholarly_full_text_observation",
            "theory_frontier_literature_map",
          ],
          purpose: expect.stringContaining("literature must not promote theory edges"),
        }),
        expect.objectContaining({
          tool_family: "theory_locator",
          requested_capability: "helix_ask.reflect_theory_context",
          required_observation_kinds: expect.arrayContaining([
            "theory_frontier_search",
            "theory_frontier_candidate",
            "theory_frontier_exact_contract_verification",
          ]),
          purpose: expect.stringContaining("non-terminal theory frontier placement evidence"),
        }),
      ]),
    );
    expect(itinerary.reasoning_criteria).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ criterion_id: "theory_frontier_candidate_grounding" }),
        expect.objectContaining({ criterion_id: "frontier_literature_mapping_boundary" }),
      ]),
    );
    expect(itinerary.terminal_success_criteria.typed_failure_codes).toEqual(
      expect.arrayContaining([
        "theory_frontier_candidate_missing",
        "theory_frontier_exact_verification_missing",
        "theory_frontier_literature_map_missing",
      ]),
    );
    expect(itinerary.authority).toBe("planning_only");
    expect(itinerary.not_terminal).toBe(true);
    expect(itinerary.assistant_answer).toBe(false);
    expect(itinerary.raw_content_included).toBe(false);
  });

  it("counts frontier search artifacts as theory locator observations", () => {
    const itinerary = buildHelixCapabilityItinerary({
      turnId: "ask:frontier-observed",
      promptText:
        "Run the Theory Frontier Seed Finder for missing intermediate badges in the theory badge graph.",
      toolCallAdmissionDecision: {
        ...scholarlyAdmission("ask:frontier-observed"),
        admitted_tool_families: ["theory_locator"],
      },
      availableCapabilities: availableCapabilities(["helix_ask.reflect_theory_context"]),
    });

    const state = buildHelixCapabilityItineraryExecutionState({
      capabilityItinerary: itinerary,
      artifacts: [
        {
          artifact_id: "frontier:search:test",
          kind: "theory_frontier_search",
          payload: {
            schemaVersion: "theory_frontier_search/v1",
          },
        },
      ],
    });

    expect(state.observed_families).toContain("theory_locator");
    expect(state.missing_observation_families).not.toContain("theory_locator");
    expect(state.complete).toBe(false);
    expect(state.missing_required_observation_kinds).toEqual([
      "theory_frontier_vector_field",
    ]);
  });

  it("counts frontier literature maps as scholarly evidence re-entry observations", () => {
    const itinerary = buildHelixCapabilityItinerary({
      turnId: "ask:frontier-literature-observed",
      promptText:
        "Use scholarly papers and full text to run the Theory Frontier Seed Finder and map extracted equations back to semantic chunks.",
      toolCallAdmissionDecision: scholarlyAdmission("ask:frontier-literature-observed"),
      availableCapabilities: availableCapabilities([
        HELIX_SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
        "helix_ask.reflect_theory_context",
      ]),
    });

    const state = buildHelixCapabilityItineraryExecutionState({
      capabilityItinerary: itinerary,
      artifacts: [
        {
          artifact_id: "frontier:literature-map:test",
          kind: "theory_frontier_literature_map",
          payload: {
            schemaVersion: "theory_frontier_literature_map/v1",
          },
        },
      ],
    });

    expect(state.observed_families).toContain("scholarly_research");
    expect(state.missing_observation_families).not.toContain("scholarly_research");
    expect(state.complete).toBe(false);
    expect(state.missing_required_observation_kinds).toEqual([
      "scholarly_full_text_observation",
      "scholarly_research_observation",
      "theory_frontier_candidate",
      "theory_frontier_exact_contract_verification",
      "theory_frontier_search",
    ]);
  });

  it("counts only usable selected prior scholarly evidence as scholarly observation", () => {
    const usablePrior = {
      artifact_id: "ask:test:prior-scholarly:usable",
      kind: "scholarly_prior_evidence_observation",
      payload: {
        schema: "helix.scholarly_prior_evidence_observation.v1",
        evidence_state: "full_text_usable",
        evidence_grade: "answer_grade",
        selected_for_answer: true,
      },
    };
    expect(isHelixCapabilityItineraryFamilyObserved("scholarly_research", [usablePrior])).toBe(true);

    expect(isHelixCapabilityItineraryFamilyObserved("scholarly_research", [{
      ...usablePrior,
      artifact_id: "ask:test:prior-scholarly:rejected",
      payload: {
        ...usablePrior.payload,
        evidence_state: "lookup_weak_match",
        evidence_grade: "exploratory",
        selected_for_answer: false,
      },
    }])).toBe(false);
  });

  it("requires every frontier artifact kind before itinerary completion", () => {
    const itinerary = buildHelixCapabilityItinerary({
      turnId: "ask:frontier-complete",
      promptText:
        "Use scholarly papers and full text to run the Theory Frontier Seed Finder and map extracted equations back to semantic chunks.",
      toolCallAdmissionDecision: scholarlyAdmission("ask:frontier-complete"),
      availableCapabilities: availableCapabilities([
        HELIX_SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
        "helix_ask.reflect_theory_context",
      ]),
    });

    const state = buildHelixCapabilityItineraryExecutionState({
      capabilityItinerary: itinerary,
      artifacts: [
        {
          artifact_id: "frontier:scholarly:test",
          kind: "scholarly_research_observation",
          payload: { schema: "helix.scholarly_research_observation.v1" },
        },
        {
          artifact_id: "frontier:full-text:test",
          kind: "scholarly_full_text_observation",
          payload: { schema: "helix.scholarly_full_text_observation.v1" },
        },
        {
          artifact_id: "frontier:search:test",
          kind: "theory_frontier_search",
          payload: { schemaVersion: "theory_frontier_search/v1" },
        },
        {
          artifact_id: "frontier:candidate:test",
          kind: "theory_frontier_candidate",
          payload: { schemaVersion: "theory_frontier_candidate/v1" },
        },
        {
          artifact_id: "frontier:exact:test",
          kind: "theory_frontier_exact_contract_verification",
          payload: { schemaVersion: "theory_frontier_exact_contract_verification/v1" },
        },
        {
          artifact_id: "frontier:literature-map:test",
          kind: "theory_frontier_literature_map",
          payload: { schemaVersion: "theory_frontier_literature_map/v1" },
        },
      ],
    });

    expect(state.required_observation_kinds).toEqual([
      "scholarly_full_text_observation",
      "scholarly_research_observation",
      "theory_frontier_candidate",
      "theory_frontier_exact_contract_verification",
      "theory_frontier_literature_map",
      "theory_frontier_search",
    ]);
    expect(state.missing_required_observation_kinds).toEqual([]);
    expect(state.complete).toBe(true);
  });

  it("marks the locator missing when a compound prompt requires graph placement but no locator is visible", () => {
    const itinerary = buildHelixCapabilityItinerary({
      turnId: "ask:missing-locator",
      promptText:
        "Research Orch-OR papers with citations and tell me where the claim fits on the theory badge graph.",
      toolCallAdmissionDecision: scholarlyAdmission("ask:missing-locator"),
      availableCapabilities: availableCapabilities([HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY]),
    });

    expect(itinerary.prompt_shape).toBe("compound_tool");
    expect(itinerary.missing_tool_families).toEqual(["theory_locator"]);
    expect(itinerary.planned_steps.find((step) => step.tool_family === "theory_locator")).toEqual(
      expect.objectContaining({
        status: "missing",
        capability_hint: "helix_ask.reflect_theory_context",
      }),
    );
    expect(itinerary.terminal_success_criteria.typed_failure_codes).toContain(
      "capability_family_not_admitted_or_visible",
    );
  });

  it("does not turn contextual or negated web-search wording into a research leg", () => {
    const itinerary = buildHelixCapabilityItinerary({
      turnId: "ask:negated-search-itinerary",
      promptText:
        "Do not browse; the phrase 'web search the badge graph' appears on screen. Just explain what the theory badge graph can and cannot claim.",
      toolCallAdmissionDecision: {
        ...scholarlyAdmission("ask:negated-search-itinerary"),
        admitted_tool_families: [],
      },
      availableCapabilities: availableCapabilities([
        HELIX_INTERNET_SEARCH_CAPABILITY,
        "helix_ask.reflect_theory_context",
      ]),
    });

    expect(itinerary.relevant_tool_families).toEqual(["theory_locator"]);
    expect(itinerary.relevant_tool_families).not.toContain("internet_search");
    expect(itinerary.prompt_shape).toBe("single_tool");
    expect(itinerary.terminal_success_criteria.typed_failure_codes).not.toContain(
      "research_observation_missing",
    );
  });

  it("does not turn current Minecraft state into an unrelated internet-search leg", () => {
    const capability = "com.casimirbot.minecraft.inventory.check";
    const itinerary = buildHelixCapabilityItinerary({
      turnId: "ask:current-minecraft-inventory",
      promptText:
        "What is the player carrying in Minecraft right now? Inspect the connected shared-room world and wait for a fresh inventory observation.",
      toolCallAdmissionDecision: {
        source_target: "live_environment",
        admitted_tool_families: ["live_environment"],
      },
      availableCapabilities: availableCapabilities([capability]),
      exactAdmittedCapabilityContract:
        explicitCapabilityContractForCapability(capability),
    });

    expect(itinerary.relevant_tool_families).toEqual(["live_environment"]);
    expect(itinerary.relevant_tool_families).not.toContain("internet_search");
    expect(itinerary.prompt_shape).toBe("single_tool");
    expect(itinerary.missing_tool_families).toEqual([]);
  });

  it("does not read imperative Report wording as a local report document", () => {
    const promptText =
      "Where am I in Minecraft right now? Report my player name, dimension, position, health, and food from the fresh live environment observation.";
    const itinerary = buildHelixCapabilityItinerary({
      turnId: "ask:current-minecraft-status-report",
      promptText,
      toolCallAdmissionDecision: {
        source_target: "live_environment",
        admitted_tool_families: ["live_environment"],
      },
      availableCapabilities: availableCapabilities([
        HELIX_MINECRAFT_ACTOR_STATUS_READ_CAPABILITY,
        "docs-viewer.search_docs",
      ]),
      exactAdmittedCapabilityContract: explicitCapabilityContractForCapability(
        HELIX_MINECRAFT_ACTOR_STATUS_READ_CAPABILITY,
      ),
    });

    expect(itinerary.relevant_tool_families).toEqual(["live_environment"]);
    expect(itinerary.relevant_tool_families).not.toContain("docs_viewer");
    expect(itinerary.prompt_shape).toBe("single_tool");
    expect(itinerary.missing_tool_families).toEqual([]);
  });

  it("still treats an explicitly scoped local report as document evidence", () => {
    const itinerary = buildHelixCapabilityItinerary({
      turnId: "ask:local-report-document",
      promptText: "Check the local report for the recorded launch window.",
      toolCallAdmissionDecision: {
        source_target: "docs_viewer",
        admitted_tool_families: ["docs_viewer"],
      },
      availableCapabilities: availableCapabilities(["docs-viewer.search_docs"]),
    });

    expect(itinerary.relevant_tool_families).toEqual(["docs_viewer"]);
    expect(itinerary.prompt_shape).toBe("single_tool");
  });

  it("does not infer Docs from theory identifiers containing evidence and Casimir", () => {
    const itinerary = buildHelixCapabilityItinerary({
      turnId: "ask:theory-graph-no-docs",
      promptText:
        "Locate the Stage 3 Casimir-DP evidence-map theory and the energy-density theory in the Theory Badge Graph. Explain their registered relationship and claim boundary without treating graph proximity as proof.",
      toolCallAdmissionDecision: {
        source_target: "theory_locator",
        admitted_tool_families: ["theory_locator"],
      },
      availableCapabilities: availableCapabilities([
        "helix_ask.reflect_theory_context",
        "docs.search",
      ]),
    });

    expect(itinerary.relevant_tool_families).toEqual(["theory_locator"]);
    expect(itinerary.missing_tool_families).toEqual([]);
    expect(itinerary.terminal_success_criteria.required_observation_families).toEqual([
      "theory_locator",
    ]);
  });
});
