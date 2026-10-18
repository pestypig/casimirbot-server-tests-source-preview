import { describe, expect, it } from "vitest";

import {
  answerScopeForExplicitCapability,
  canonicalGoalKindForExplicitCapability,
} from "../services/helix-ask/capability-contract-arbitration";
import {
  explicitCapabilityContractsForTests,
  explicitCapabilityContractForCapability,
  extractExplicitCapabilityContracts,
} from "../services/helix-ask/explicit-capability-contract";
import { arbitrateAskSourceTarget } from "../services/helix-ask/ask-source-target-arbitrator";
import { WORKSTATION_CONTEXT_FEED_QUERY_TOOL_CONTRACT_SPECS } from "../services/helix-ask/workstation-context-feed-query-tool-contracts";

describe("Helix capability contract arbitration", () => {
  it("routes every canonical workstation context-feed query capability to live environment review", () => {
    for (const spec of WORKSTATION_CONTEXT_FEED_QUERY_TOOL_CONTRACT_SPECS) {
      expect(canonicalGoalKindForExplicitCapability(spec.capability)).toBe("live_environment_review");
      expect(answerScopeForExplicitCapability(spec.capability)).toBe("live_environment_state");
    }
  });

  it("keeps explicit capability commands on domain-specific canonical goals and scopes", () => {
    const cases = [
      ["helix_ask.reflect_workstation_tool_alignment", "capability_help", "runtime_evidence"],
      ["helix_ask.inspect_capability_catalog", "capability_help", "runtime_evidence"],
      ["scientific-calculator.solve_expression", "calculator_solve", "current_turn_action"],
      ["scientific-calculator.solve_with_steps", "calculator_solve", "current_turn_action"],
      ["scientific-calculator.solve", "calculator_solve", "current_turn_action"],
      ["scientific-calculator.open", "calculator_open", "current_turn_action"],
      ["scientific-calculator.start_equation_live_source", "calculator_live_source_setup", "current_turn_action"],
      ["workspace_os.status", "workspace_status_diagnostic", "workspace_state"],
      ["docs-viewer.open", "doc_open", "current_turn_doc"],
      ["docs-viewer.open_doc_by_path", "doc_open", "current_turn_doc"],
      ["docs-viewer.identify_current_doc", "active_doc_identity", "current_turn_doc"],
      ["docs-viewer.search_docs", "docs_search", "current_turn_doc"],
      ["docs-viewer.validate_doc_candidates", "doc_candidate_validation", "current_turn_doc"],
      ["docs-viewer.locate_in_doc", "locate_in_doc", "current_turn_doc"],
      ["docs-viewer.summarize_doc", "doc_summary", "current_turn_doc"],
      ["docs-viewer.doc_equation_context", "doc_equation_context", "current_turn_doc"],
      ["repo-code.search_concept", "repo_code_evidence_question", "repo_evidence"],
      ["workspace-directory.resolve", "workspace_directory_resolution", "workspace_state"],
      ["internet_search.web_research", "internet_search_lookup", "external_internet_search"],
      ["scholarly-research.lookup_papers", "scholarly_research_lookup", "external_scholarly_research"],
      ["scholarly-research.fetch_full_text", "scholarly_full_text_lookup", "external_scholarly_research"],
      ["helix_ask.reflect_theory_context", "theory_context_reflection", "theory_context"],
      ["theory-experiment-procedure.prepare", "theory_context_reflection", "theory_context"],
      ["theory-experiment-procedure.readmit", "theory_context_reflection", "theory_context"],
      ["theory-experiment-procedure.evaluate_closure", "theory_context_reflection", "theory_context"],
      ["helix.theory.frontierVectorFieldTrace", "theory_frontier_vector_field", "theory_context"],
      ["helix_ask.reflect_live_synthetic_data", "context_attachment_reflection", "context_reflection"],
      ["helix_ask.reflect_context_attachments", "context_attachment_reflection", "context_reflection"],
      ["image_lens.inspect", "visual_capture_describe", "visual_capture"],
      ["situation-room.describe_visual_capture", "visual_capture_describe", "visual_capture"],
      ["helix_ask.reflect_ideology_context", "moral_graph_reflection", "moral_graph_reflection"],
      ["helix_ask.bridge_theory_ideology_context", "theory_ideology_bridge_reflection", "moral_graph_reflection"],
      ["helix_ask.build_civilization_scenario_frame", "civilization_bounds_reflection", "civilization_bounds"],
      ["helix_ask.reflect_civilization_bounds", "civilization_bounds_reflection", "civilization_bounds"],
      ["live_env.check_live_source_mail", "live_source_mailbox_review", "live_source_mail"],
      ["live_env.read_live_source_mail", "live_source_mailbox_review", "live_source_mail"],
      ["live_env.read_processed_live_source_mail", "live_source_mailbox_review", "live_source_mail"],
      ["live_env.process_live_source_mail", "live_source_mailbox_review", "live_source_mail"],
      ["live_env.reflect_live_source_mail_loop", "live_source_mailbox_review", "live_source_mail"],
      ["live_env.query_micro_reasoner_presets", "live_source_mailbox_review", "live_source_mail"],
      ["live_env.query_micro_reasoner_prompts", "live_source_mailbox_review", "live_source_mail"],
      ["live_env.draft_micro_reasoner_preset", "live_source_mailbox_review", "live_source_mail"],
      ["live_env.route_micro_reasoner_prompt", "live_source_mailbox_review", "live_source_mail"],
      ["live_env.query_live_source_quality", "live_source_mailbox_review", "live_source_mail"],
      ["live_env.summarize_live_source_current_state", "live_source_mailbox_review", "live_source_mail"],
      ["live_env.apply_micro_reasoner_preset", "live_environment_review", "live_environment_state"],
      ["live_env.create_micro_reasoner_preset", "live_environment_review", "live_environment_state"],
      ["live_env.update_micro_reasoner_prompt", "live_environment_review", "live_environment_state"],
      ["live_env.test_micro_reasoner_prompt", "live_environment_review", "live_environment_state"],
      ["live_env.read_card", "live_environment_review", "live_environment_state"],
      ["live_env.query_event_log", "live_environment_review", "live_environment_state"],
      ["live_env.query_world_events", "live_environment_review", "live_environment_state"],
      ["live_env.query_navigation_state", "live_environment_review", "live_environment_state"],
      ["live_env.plan_stage_play_job", "live_environment_review", "live_environment_state"],
      ["live_env.configure_visual_observer_profile", "live_environment_review", "live_environment_state"],
      ["live_env.apply_visual_observer_profile", "live_environment_review", "live_environment_state"],
      ["live_env.query_visual_observer_profiles", "live_environment_review", "live_environment_state"],
      ["live_env.test_visual_observer_profile", "live_environment_review", "live_environment_state"],
      ["live_env.compare_visual_observer_profiles", "live_environment_review", "live_environment_state"],
      ["live_env.request_visual_action_replay", "live_environment_review", "live_environment_state"],
      ["live_env.configure_interpreter_profile", "live_environment_review", "live_environment_state"],
      ["live_env.compare_mail_to_interpreter_profile", "live_environment_review", "live_environment_state"],
      ["live_env.request_stage_play_checkpoint", "live_environment_review", "live_environment_state"],
      ["live_env.predict_live_source_immediate", "live_environment_review", "live_environment_state"],
      ["live_env.compare_live_source_prediction", "live_environment_review", "live_environment_state"],
      ["live_env.project_live_source_narrative", "live_environment_review", "live_environment_state"],
      ["live_env.record_live_source_mail_decision", "processed_mail_voice_decision", "live_source_mail"],
      ["live_env.request_interim_voice_callout", "processed_mail_voice_decision", "live_environment_state"],
      ["text_to_speech.speak_text", "voice_delivery", "live_environment_state"],
      ["workstation-notes.list_notes", "workstation_note_list", "workspace_state"],
      ["workstation-notes.append_to_note", "workstation_note_edit", "workspace_state"],
      ["workstation-notes.create_note", "workstation_note_edit", "workspace_state"],
      ["workstation-notes.open", "workstation_note_open", "workspace_state"],
    ] as const;

    for (const [capability, goalKind, answerScope] of cases) {
      expect(canonicalGoalKindForExplicitCapability(capability), capability).toBe(goalKind);
      expect(answerScopeForExplicitCapability(capability), capability).toBe(answerScope);
    }
  });

  it("keeps every explicit capability contract mapped to a canonical goal and answer scope", () => {
    for (const contract of explicitCapabilityContractsForTests) {
      expect(canonicalGoalKindForExplicitCapability(contract.capability), contract.capability)
        .toEqual(expect.any(String));
      expect(answerScopeForExplicitCapability(contract.capability), contract.capability)
        .toEqual(expect.any(String));
    }
  });

  it("keeps every parity target family backed by an explicit capability contract", () => {
    const cases = [
      ["calculator", "scientific-calculator.solve_expression", "calculator_receipt", "workstation_tool_evaluation"],
      ["docs_viewer", "docs-viewer.locate_in_doc", "doc_location_matches", "doc_location_matches"],
      ["repo_code", "repo-code.search_concept", "repo_code_evidence_observation", "repo_code_evidence_answer"],
      ["workspace_directory", "workspace-directory.resolve", "workspace_directory_resolution", "workspace_directory_resolution"],
      ["workspace_diagnostic", "workspace_os.status", "workspace_os_status_observation", "model_synthesized_answer"],
      ["capability_catalog", "helix_ask.inspect_capability_catalog", "capability_registry", "capability_help_summary"],
      ["internet_search", "internet_search.web_research", "internet_search_observation", "internet_search_answer"],
      ["scholarly_research", "scholarly-research.lookup_papers", "scholarly_research_observation", "scholarly_research_answer"],
      ["theory_locator", "helix_ask.reflect_theory_context", "theory_context_reflection", "theory_context_reflection_answer"],
      ["live_source_mail", "live_env.read_processed_live_source_mail", "stage_play_processed_mail_packet", "model_synthesized_answer"],
      ["live_environment", "live_env.query_workstation_goal_context", "live_environment_tool_observation", "model_synthesized_answer"],
      ["visual_capture", "image_lens.inspect", "situation_context_pack", "situation_context_pack"],
      ["civilization_bounds", "helix_ask.reflect_civilization_bounds", "civilization_bounds_roadmap/v1", "model_synthesized_answer"],
      ["moral_graph_reflection", "helix_ask.reflect_ideology_context", "ideology_context_reflection/v1", "model_synthesized_answer"],
      ["workstation", "workstation-notes.create_note", "note_update_receipt", "note_update_receipt"],
    ] as const;

    for (const [family, capability, observationKind, terminalKind] of cases) {
      const contract = explicitCapabilityContractForCapability(capability);
      expect(contract?.capability_family, capability).toBe(family);
      expect(contract?.required_observation_kinds, capability).toContain(observationKind);
      expect(contract?.required_terminal_kind, capability).toBe(terminalKind);
      expect(contract?.allowed_substitutions, capability).toEqual(expect.any(Array));
      expect(contract?.forbidden_nearby_capabilities, capability).toContain("model.direct_answer");
      expect(contract?.required_args, capability).toEqual(expect.any(Array));
    }
  });

  it("extracts an explicit requested capability for every parity target family", () => {
    const cases = [
      ["calculator", "Call scientific-calculator.solve_expression with this exact expression: 2+2.", "scientific-calculator.solve_expression"],
      ["docs_viewer", "Use docs-viewer.locate_in_doc to cite the terminal authority rule.", "docs-viewer.locate_in_doc"],
      ["repo_code", "Use repo-code.search_concept to find terminal authority enforcement.", "repo-code.search_concept"],
      ["workspace_directory", "Run workspace-directory.resolve for docs/helix-ask-codex-loop-discipline.md.", "workspace-directory.resolve"],
      ["workspace_diagnostic", "Use workspace_os.status to inspect workstation status.", "workspace_os.status"],
      ["capability_catalog", "Call helix_ask.inspect_capability_catalog to list visible tools.", "helix_ask.inspect_capability_catalog"],
      ["internet_search", "Use internet_search.web_research to find a cited paper source.", "internet_search.web_research"],
      ["scholarly_research", "Call scholarly-research.lookup_papers for Alcubierre metric papers.", "scholarly-research.lookup_papers"],
      ["theory_locator", "Use helix_ask.reflect_theory_context to map this claim on the theory graph.", "helix_ask.reflect_theory_context"],
      ["theory_locator", "Prepare a seven-stage theory experiment procedure for badge study.casimir_dp.evidence_map_stage3.", "theory-experiment-procedure.prepare"],
      ["theory_locator", "Call theory-experiment-procedure.readmit for the exact retained procedure.", "theory-experiment-procedure.readmit"],
      ["theory_locator", "Continue the execution-closure workflow for the admitted procedure.", "theory-experiment-procedure.evaluate_closure"],
      ["live_source_mail", "Run live_env.read_processed_live_source_mail to inspect processed mailbox evidence.", "live_env.read_processed_live_source_mail"],
      ["live_environment", "Call live_env.query_workstation_goal_context to inspect goal context.", "live_env.query_workstation_goal_context"],
      ["visual_capture", "Use situation-room.describe_visual_capture to inspect the current visual frame.", "image_lens.inspect"],
      ["civilization_bounds", "Call helix_ask.reflect_civilization_bounds to reflect collaboration bounds.", "helix_ask.reflect_civilization_bounds"],
      ["moral_graph_reflection", "Use helix_ask.reflect_ideology_context to reflect the moral graph context.", "helix_ask.reflect_ideology_context"],
    ] as const;

    for (const [family, promptText, expectedCapability] of cases) {
      const extracted = extractExplicitCapabilityContracts(promptText);
      expect(extracted.map((entry) => entry.contract.capability), family).toContain(expectedCapability);
      const match = extracted.find((entry) => entry.contract.capability === expectedCapability);
      expect(match?.contract.capability_family, family).toBe(family);
      expect(match?.source, family).toBe("command_mention");
    }
  });

  it("maps natural read-only notes and literal voice commands onto explicit capability contracts", () => {
    const cases = [
      [
        "Check my workstation notes and tell me what topics are available.",
        "workstation-notes.list_notes",
      ],
      [
        "Say this aloud: The evidence is diagnostic, not conclusive.",
        "text_to_speech.speak_text",
      ],
    ] as const;

    for (const [promptText, expectedCapability] of cases) {
      expect(
        extractExplicitCapabilityContracts(promptText).map((entry) => ({
          capability: entry.contract.capability,
          source: entry.source,
        })),
        promptText,
      ).toContainEqual({
        capability: expectedCapability,
        source: "natural_capability_intent",
      });
    }
  });

  it("maps a bounded natural Minecraft structure survey despite an explicit no-mutation constraint", () => {
    const promptText =
      "Look around my selected Minecraft player in the paired Fabric world. Without changing anything, inspect a bounded area large enough to find any stone-brick wall within 16 blocks, and tell me the exact endpoints and dimensions of every freestanding stone-brick wall you can verify. If there is no such wall, say so.";
    const extracted = extractExplicitCapabilityContracts(promptText, {
      trusted_environment_domain: "minecraft",
    });

    expect(
      extracted.map((entry) => ({
        capability: entry.contract.capability,
        source: entry.source,
      })),
    ).toContainEqual({
      capability: "com.casimirbot.minecraft.spatial_region.inspect",
      source: "natural_capability_intent",
    });
    expect(
      extracted.map((entry) => entry.contract.capability),
    ).not.toContain("com.casimirbot.minecraft.command");
    expect(
      arbitrateAskSourceTarget({
        turnId: "ask:natural-minecraft-structure-survey",
        threadId: "helix-ask:room:natural-minecraft-structure-survey",
        promptText,
        trustedEnvironmentContext: {
          trusted_environment_domain: "minecraft",
        },
      }),
    ).toMatchObject({
      target_source: "live_environment",
      target_kind: "live_environment",
      strength: "hard",
      allow_no_tool_direct: false,
      explicit_cues: [
        "explicit_capability:com.casimirbot.minecraft.spatial_region.inspect",
      ],
    });
  });

  it("keeps contextual Minecraft structure-survey language out of execution", () => {
    const prompts = [
      "Do not inspect for a stone-brick wall within 16 blocks; only explain what that survey would return.",
      "Later, inspect for a stone-brick wall within 16 blocks, but do not do it now.",
      "Earlier I asked you to inspect for a stone-brick wall within 16 blocks; explain why.",
      'The screen says "inspect for a stone-brick wall within 16 blocks"; explain that text.',
      "If I ask later, inspect for a stone-brick wall within 16 blocks.",
    ];

    for (const promptText of prompts) {
      expect(
        extractExplicitCapabilityContracts(promptText, {
          trusted_environment_domain: "minecraft",
        }).map((entry) => entry.contract.capability),
        promptText,
      ).not.toContain("com.casimirbot.minecraft.spatial_region.inspect");
    }
  });

  it("keeps requested Minecraft command syntax as documentation rather than execution", () => {
    const documentationPrompt =
      "Before doing anything in Minecraft, look up the connected environment mechanics for how to capture only the exact wall footprint as a rollback checkpoint. Cite the exact source file and line range and give the exact command form. Do not execute any Minecraft command.";
    const documentationCapabilities = extractExplicitCapabilityContracts(
      documentationPrompt,
      { trusted_environment_domain: "minecraft" },
    ).map((entry) => entry.contract.capability);

    expect(documentationCapabilities).toContain("docs-viewer.search_docs");
    expect(documentationCapabilities).not.toContain(
      "com.casimirbot.minecraft.command",
    );

    for (const executionPrompt of [
      "Give my selected Minecraft player a diamond now.",
      "Give my selected Minecraft player a temporary glowing effect now.",
    ]) {
      expect(
        extractExplicitCapabilityContracts(executionPrompt, {
          trusted_environment_domain: "minecraft",
        }).map((entry) => entry.contract.capability),
        executionPrompt,
      ).toContain("com.casimirbot.minecraft.command");
    }
  });

  it("does not execute natural notes or voice capabilities from contextual mentions", () => {
    const cases = [
      ["Do not check my workstation notes; just explain what notes are.", "workstation-notes.list_notes"],
      ["Later, check my workstation notes and tell me what is available.", "workstation-notes.list_notes"],
      ['The screen says "check my workstation notes"; explain that label only.', "workstation-notes.list_notes"],
      ["Do not say this aloud: The evidence is diagnostic.", "text_to_speech.speak_text"],
      ["Later, say this aloud: The evidence is diagnostic.", "text_to_speech.speak_text"],
      ['The prompt says "Say this aloud: hello"; explain the quote only.', "text_to_speech.speak_text"],
    ] as const;

    for (const [promptText, forbiddenCapability] of cases) {
      expect(
        extractExplicitCapabilityContracts(promptText).map(
          (entry) => entry.contract.capability,
        ),
        promptText,
      ).not.toContain(forbiddenCapability);
    }
  });

  it("readmits an exact retained procedure only for affirmative commands", () => {
    const capability = "theory-experiment-procedure.readmit";
    expect(explicitCapabilityContractForCapability(capability)).toMatchObject({
      capability_family: "theory_locator",
      required_args: [
        "procedure_artifact_ref",
        "procedure_id",
        "procedure_sha256",
      ],
      required_observation_kinds: [
        "theory_experiment_procedure_observation",
      ],
      required_terminal_kind: "model_synthesized_answer",
    });

    for (const promptText of [
      "Call theory-experiment-procedure.readmit for the exact retained procedure.",
      "Use theory_experiment_procedure_readmit now with its original artifact binding.",
    ]) {
      expect(
        extractExplicitCapabilityContracts(promptText).map(
          (entry) => entry.contract.capability,
        ),
        promptText,
      ).toContain(capability);
    }

    for (const promptText of [
      "Do not call theory-experiment-procedure.readmit; explain retention only.",
      "Later we may call theory-experiment-procedure.readmit.",
      "Earlier I asked you to call theory-experiment-procedure.readmit.",
      'The notes say "call theory-experiment-procedure.readmit"; explain that quote.',
      "The screen shows theory-experiment-procedure.readmit, but only explain the label.",
      "What does theory-experiment-procedure.readmit do?",
    ]) {
      expect(
        extractExplicitCapabilityContracts(promptText).map(
          (entry) => entry.contract.capability,
        ),
        promptText,
      ).not.toContain(capability);
    }
  });

  it("requires closure evidence for affirmative execution-closure commands without admitting contextual mentions", () => {
    const closureCapability =
      "theory-experiment-procedure.evaluate_closure";
    const contract =
      explicitCapabilityContractForCapability(closureCapability);
    expect(contract).toMatchObject({
      capability_family: "theory_locator",
      source_target: "theory_locator",
      required_args: ["prompt", "procedure_id", "procedure_sha256"],
      required_observation_kinds: [
        "theory_experiment_execution_closure",
      ],
      required_terminal_kind: "model_synthesized_answer",
    });
    expect(contract?.required_observation_kinds).not.toContain(
      "theory_experiment_procedure_observation",
    );

    for (const promptText of [
      "Continue the execution-closure workflow for the admitted procedure.",
      "Evaluate the theory execution closure now.",
      "Run theory-experiment-procedure.evaluate_closure with the exact admitted procedure binding.",
    ]) {
      expect(
        extractExplicitCapabilityContracts(promptText).map(
          (entry) => entry.contract.capability,
        ),
        promptText,
      ).toContain(closureCapability);
    }

    for (const promptText of [
      "Do not run the execution closure; explain the prepared procedure only.",
      "In the future, run the execution closure after the evidence arrives.",
      "Earlier I asked you to run the execution closure.",
      'The notes say "run the execution closure"; explain that quote.',
      "The screen says run theory-experiment-procedure.evaluate_closure, but only explain the label.",
      "What does the execution-closure workflow do?",
    ]) {
      expect(
        extractExplicitCapabilityContracts(promptText).map(
          (entry) => entry.contract.capability,
        ),
        promptText,
      ).not.toContain(closureCapability);
    }
  });

  it("registers each execution-closure evidence rail as nonterminal theory-locator work", () => {
    const cases = [
      ["theory-semantic-admitter.normalize", "semantic_admission"],
      [
        "theory-artifact-producer.prepare_lanyon_request",
        "theory_artifact_producer_lanyon_request_observation",
      ],
      ["theory-artifact-producer.admit_lanyon_snapshot", "artifact_generation_receipt"],
      ["theory-formal-verifier.inspect_artifact_family", "theory_formal_artifact_family_audit_observation"],
      ["theory-formal-verifier.prepare_request", "theory_formal_verifier_preparation_observation"],
      ["theory-formal-verifier.plan", "theory_formal_verifier_plan_observation"],
      ["theory-formal-verifier.start", "theory_formal_verifier_start_observation"],
      ["theory-formal-verifier.read_result", "formal_certificate"],
      ["theory-independent-numerical-verifier.prepare_request", "theory_independent_numerical_verifier_prepared_request_observation"],
      ["theory-independent-numerical-verifier.plan", "theory_independent_numerical_verifier_plan_observation"],
      ["theory-independent-numerical-verifier.start", "theory_independent_numerical_verifier_start_observation"],
      ["theory-independent-numerical-verifier.read_result", "numerical_certificate"],
    ] as const;

    for (const [capability, observationKind] of cases) {
      const contract =
        explicitCapabilityContractForCapability(capability);
      expect(contract, capability).toMatchObject({
        capability_family: "theory_locator",
        plan_family: "theory_locator",
        source_target: "theory_locator",
        required_observation_kinds: [observationKind],
        required_terminal_kind: "model_synthesized_answer",
        forbidden_nearby_capabilities: ["model.direct_answer"],
      });
      expect(
        canonicalGoalKindForExplicitCapability(capability),
        capability,
      ).toBe("theory_context_reflection");
      expect(
        answerScopeForExplicitCapability(capability),
        capability,
      ).toBe("theory_context");
    }

    const lanyonContract = explicitCapabilityContractForCapability(
      "theory-artifact-producer.admit_lanyon_snapshot",
    );
    expect(lanyonContract?.required_args).toEqual([
      "request_artifact_ref",
      "case_id",
    ]);
    expect(lanyonContract?.optional_args).not.toContain("source_root");
    expect(lanyonContract?.optional_args).not.toContain("sourceRoot");

    const preparerContract = explicitCapabilityContractForCapability(
      "theory-artifact-producer.prepare_lanyon_request",
    );
    expect(preparerContract?.required_args).toEqual([
      "procedure_artifact_ref",
      "procedure_id",
      "procedure_sha256",
      "semantic_admission_artifact_ref",
      "case_id",
    ]);

    const inspectCapability =
      "theory-formal-verifier.inspect_artifact_family";
    expect(
      extractExplicitCapabilityContracts(
        "Call theory-formal-verifier.inspect_artifact_family now for the audited GR-Maxwell theorem.",
      ).map((entry) => entry.contract.capability),
    ).toContain(inspectCapability);
    for (const promptText of [
      "Do not call theory-formal-verifier.inspect_artifact_family; explain its contract.",
      "Later we may call theory-formal-verifier.inspect_artifact_family.",
      "Earlier the agent called theory-formal-verifier.inspect_artifact_family.",
      'The notes say "call theory-formal-verifier.inspect_artifact_family"; explain that quote.',
      "The screen shows theory-formal-verifier.inspect_artifact_family, but only describe it.",
    ]) {
      expect(
        extractExplicitCapabilityContracts(promptText).map(
          (entry) => entry.contract.capability,
        ),
        promptText,
      ).not.toContain(inspectCapability);
    }
  });

  it("keeps research-paper and Image Lens workflow questions explanatory", () => {
    const prompts = [
      "Does your research-paper tool let you choose papers it can parse, or do you first check which papers are openable and then use Image Lens? Answer only from your capability contract. Do not retrieve a paper or call a tool.",
      "does your tool for research papers allow you to pick papers you are able to parse? or do you check what papers are openable to then use image lens?",
      "In the future, will your research-paper tool use Image Lens after checking which papers are openable?",
      "Earlier I asked whether your research-paper tool would use Image Lens; explain the workflow now.",
      "The screen says, ‘Does your research-paper tool use Image Lens?’ Explain that capability question only.",
    ];

    for (const promptText of prompts) {
      const capabilities = extractExplicitCapabilityContracts(promptText)
        .map((entry) => entry.contract.capability);
      expect(capabilities, promptText).not.toContain("image_lens.inspect");
      expect(capabilities, promptText).not.toContain("scholarly-research.lookup_papers");
      expect(capabilities, promptText).not.toContain("scholarly-research.fetch_full_text");
    }
  });

  it("preserves a later affirmative Image Lens command after a capability question", () => {
    const capabilities = extractExplicitCapabilityContracts(
      "Does your research-paper tool use Image Lens for scanned equations? Then use Image Lens to inspect the attached page.",
    ).map((entry) => entry.contract.capability);

    expect(capabilities).toContain("helix_ask.inspect_capability_catalog");
    expect(capabilities.filter((capability) => capability === "image_lens.inspect")).toHaveLength(1);
  });

  it("covers the named explicit tool-call parity surface with contracts and extraction", () => {
    const cases = [
      [
        "scientific-calculator.solve_expression",
        "scientific-calculator.solve_expression",
        "calculator",
        "calculator_receipt",
        "workstation_tool_evaluation",
      ],
      [
        "repo-code.search_concept",
        "repo-code.search_concept",
        "repo_code",
        "repo_code_evidence_observation",
        "repo_code_evidence_answer",
      ],
      [
        "docs-viewer.locate_in_doc",
        "docs-viewer.locate_in_doc",
        "docs_viewer",
        "doc_location_matches",
        "doc_location_matches",
      ],
      [
        "docs-viewer.doc_equation_context",
        "docs-viewer.doc_equation_context",
        "docs_viewer",
        "doc_equation_context",
        "doc_equation_context",
      ],
      [
        "workspace-directory.resolve",
        "workspace-directory.resolve",
        "workspace_directory",
        "workspace_directory_resolution",
        "workspace_directory_resolution",
      ],
      [
        "internet_search.web_research",
        "internet_search.web_research",
        "internet_search",
        "internet_search_observation",
        "internet_search_answer",
      ],
      [
        "scholarly-research.lookup_papers",
        "scholarly-research.lookup_papers",
        "scholarly_research",
        "scholarly_research_observation",
        "scholarly_research_answer",
      ],
      [
        "helix_ask.reflect_theory_context",
        "helix_ask.reflect_theory_context",
        "theory_locator",
        "theory_context_reflection",
        "theory_context_reflection_answer",
      ],
      [
        "live_env.query_micro_reasoner_presets",
        "live_env.query_micro_reasoner_presets",
        "live_source_mail",
        "stage_play_micro_reasoner_prompt_preset_query_result",
        "model_synthesized_answer",
      ],
      [
        "live_env.draft_micro_reasoner_preset",
        "live_env.draft_micro_reasoner_preset",
        "live_source_mail",
        "stage_play_micro_reasoner_prompt_preset_draft",
        "model_synthesized_answer",
      ],
      [
        "live_env.route_micro_reasoner_prompt",
        "live_env.route_micro_reasoner_prompt",
        "live_source_mail",
        "stage_play_micro_reasoner_prompt_delegation_result",
        "model_synthesized_answer",
      ],
      [
        "live_env.read_processed_live_source_mail",
        "live_env.read_processed_live_source_mail",
        "live_source_mail",
        "stage_play_processed_mail_packet",
        "model_synthesized_answer",
      ],
      [
        "live_env.process_live_source_mail",
        "live_env.process_live_source_mail",
        "live_source_mail",
        "stage_play_processed_mail_packet",
        "model_synthesized_answer",
      ],
      [
        "live_env.reflect_live_source_mail_loop",
        "live_env.reflect_live_source_mail_loop",
        "live_source_mail",
        "stage_play_live_source_mail_loop_reflection",
        "model_synthesized_answer",
      ],
      [
        "live_env.record_live_source_mail_decision",
        "live_env.record_live_source_mail_decision",
        "live_source_decision",
        "stage_play_live_source_mail_decision",
        "model_synthesized_answer",
      ],
      [
        "live_env.request_interim_voice_callout",
        "live_env.request_interim_voice_callout",
        "voice_delivery",
        "live_source_interim_voice_callout_receipt",
        "model_synthesized_answer",
      ],
      [
        "workspace_os.status",
        "workspace_os.status",
        "workspace_diagnostic",
        "workspace_os_status_observation",
        "model_synthesized_answer",
      ],
      [
        "helix_ask.reflect_ideology_context",
        "helix_ask.reflect_ideology_context",
        "moral_graph_reflection",
        "ideology_context_reflection/v1",
        "model_synthesized_answer",
      ],
      [
        "helix_ask.build_civilization_scenario_frame",
        "helix_ask.build_civilization_scenario_frame",
        "civilization_bounds",
        "civilization_scenario_frame/v1",
        "model_synthesized_answer",
      ],
      [
        "helix_ask.reflect_civilization_bounds",
        "helix_ask.reflect_civilization_bounds",
        "civilization_bounds",
        "civilization_bounds_roadmap/v1",
        "model_synthesized_answer",
      ],
      [
        "situation-room.describe_visual_capture",
        "image_lens.inspect",
        "visual_capture",
        "situation_context_pack",
        "situation_context_pack",
      ],
    ] as const;

    for (const [requestedName, expectedCapability, family, observationKind, terminalKind] of cases) {
      const contract = explicitCapabilityContractForCapability(requestedName);
      expect(contract?.capability, requestedName).toBe(expectedCapability);
      expect(contract?.capability_family, requestedName).toBe(family);
      expect(contract?.required_observation_kinds, requestedName).toContain(observationKind);
      expect(contract?.required_terminal_kind, requestedName).toBe(terminalKind);
      expect(contract?.forbidden_nearby_capabilities, requestedName).toContain("model.direct_answer");

      const extracted = extractExplicitCapabilityContracts(`Call ${requestedName} for the parity rail check.`);
      expect(extracted.map((entry) => entry.contract.capability), requestedName).toContain(expectedCapability);
    }
  });
});
