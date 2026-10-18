import { describe, expect, it } from "vitest";
import { resolveCompoundCapabilitySynthesisReadiness } from "../services/helix-ask/compound-capability-synthesis";
import { buildHelixCompoundCapabilityContract } from "../services/helix-ask/compound-capability-contract";
import { resolveAskCapabilityContractArbitration } from "../services/helix-ask/capability-contract-arbitration";
import { buildHelixCapabilityItineraryExecutionState } from "../services/helix-ask/capability-itinerary-execution";
import { materializeFinalAnswerDraftTerminal } from "../services/helix-ask/final-answer-draft-terminal-materializer";
import { inferFinalAnswerDraftRouteFamily } from "../services/helix-ask/final-answer-draft-quality-gate";

describe("compound capability synthesis readiness", () => {
  it("does not satisfy docs locate subgoals with empty location matches", () => {
    const turnId = "ask:test:empty-doc-location-subgoal";
    const docsSubgoalId = `${turnId}:compound_capability_subgoal:1:docs-viewer_locate_in_doc`;
    const state = buildHelixCapabilityItineraryExecutionState({
      capabilityItinerary: {
        terminal_success_criteria: {
          requires_post_observation_synthesis: true,
          required_observation_families: ["docs_viewer"],
          required_capabilities: ["docs-viewer.locate_in_doc"],
        },
        compound_capability_contract: {
          subgoals: [
            {
              subgoal_id: docsSubgoalId,
              order: 1,
              requested_capability: "docs-viewer.locate_in_doc",
              runtime_capability: "docs-viewer.locate_in_doc",
              required_args: ["query"],
              args_hint: { query: "terminal authority" },
              required_observation_kinds: ["doc_location_matches"],
              required_terminal_kind: "doc_location_matches",
            },
          ],
        },
      },
      artifacts: [
        {
          artifact_id: `${turnId}:runtime_tool_call:1`,
          kind: "runtime_tool_call",
          payload: {
            capability_key: "docs-viewer.locate_in_doc",
            args: { query: "terminal authority" },
          },
        },
        {
          artifact_id: `${turnId}:doc_location_matches`,
          kind: "doc_location_matches",
          payload: {
            schema: "helix.doc_location_matches.v1",
            kind: "doc_location_matches",
            capability_key: "docs-viewer.locate_in_doc",
            match_count: 0,
            matches: [],
            snippets: [],
          },
        },
      ],
    });

    expect(state.complete).toBe(false);
    expect(state.missing_compound_subgoal_ids).toContain(docsSubgoalId);
    expect(state.compound_subgoal_ledger[0]).toMatchObject({
      requested_capability: "docs-viewer.locate_in_doc",
      selected_capability: "docs-viewer.locate_in_doc",
      executed_capability: null,
      observation_ref: null,
      satisfaction: "failed",
      rail_status: "fail_closed",
      rail_failure_code: "subgoal_observation_missing",
    });
  });

  it("requires synthesis when all compound subgoals are satisfied but no final draft exists", () => {
    const turnId = "ask:test:compound-synthesis";
    const docsSubgoalId = `${turnId}:compound_capability_subgoal:1:docs-viewer_locate_in_doc`;
    const calculatorSubgoalId = `${turnId}:compound_capability_subgoal:2:scientific-calculator_solve_expression`;
    const readiness = resolveCompoundCapabilitySynthesisReadiness({
      payload: {
        capability_itinerary_execution_state: {
          schema: "helix.capability_itinerary_execution_state.v1",
          applies: true,
          complete: true,
          compound_subgoal_ledger: [
            {
              subgoal_id: docsSubgoalId,
              requested_capability: "docs-viewer.locate_in_doc",
              executed_capability: "docs-viewer.locate_in_doc",
              observation_kind: "doc_location_matches",
              observation_ref: "obs:doc-location",
              satisfaction: "satisfied",
              rail_status: "complete",
            },
            {
              subgoal_id: calculatorSubgoalId,
              requested_capability: "scientific-calculator.solve_expression",
              executed_capability: "scientific-calculator.solve_expression",
              observation_kind: "calculator_receipt",
              observation_ref: "obs:calculator",
              satisfaction: "satisfied",
              rail_status: "complete",
            },
          ],
        },
      },
      artifacts: [],
    });

    expect(readiness).toMatchObject({
      applies: true,
      complete: true,
      synthesis_required: true,
      has_docs_subgoal: true,
      goal_kind: "doc_evidence_synthesis",
      required_terminal_kind: "doc_evidence_synthesis_answer",
    });
    expect(readiness.support_refs).toEqual(["obs:doc-location", "obs:calculator"]);
  });

  it("uses general compound synthesis for docs plus live Minecraft execution", () => {
    const rows = [
      {
        subgoal_id: "subgoal:mechanics-doc",
        requested_capability: "docs.search",
        executed_capability: "docs.search",
        observation_kind: "doc_location_matches",
        observation_ref: "obs:mechanics-doc",
        support_refs: ["obs:mechanics-doc"],
        satisfaction: "satisfied",
        rail_status: "complete",
      },
      {
        subgoal_id: "subgoal:minecraft-fill",
        requested_capability: "com.casimirbot.minecraft.command",
        executed_capability: "com.casimirbot.minecraft.command",
        observation_kind: "environment_command_observation",
        observation_ref: "obs:minecraft-fill",
        support_refs: ["obs:minecraft-fill"],
        satisfaction: "satisfied",
        rail_status: "complete",
      },
    ];
    const readiness = resolveCompoundCapabilitySynthesisReadiness({
      payload: {
        compound_capability_contract: {
          schema: "helix.compound_capability_contract.v1",
          subgoal_identity_policy: "provider_call_occurrence",
          requires_all_subgoals: true,
          subgoals: rows.map((row) => ({
            subgoal_id: row.subgoal_id,
            requested_capability: row.requested_capability,
            runtime_capability: row.requested_capability,
            mandatory: true,
          })),
        },
        capability_itinerary_execution_state: {
          schema: "helix.capability_itinerary_execution_state.v1",
          applies: true,
          complete: true,
          compound_subgoal_ledger: rows,
        },
      },
      artifacts: [],
    });

    expect(readiness).toMatchObject({
      applies: true,
      complete: true,
      synthesis_required: true,
      has_docs_subgoal: true,
      goal_kind: "compound_evidence_synthesis",
      required_terminal_kind: "compound_evidence_synthesis_answer",
      synthesis_terminal_kind: "compound_evidence_synthesis_answer",
    });
  });

  it("materializes docs plus calculator compounds as compound synthesis despite calculator route terminal", () => {
    const turnId = "ask:test:docs-calculator-materializer";
    const docsSubgoalId = `${turnId}:compound_capability_subgoal:1:docs-viewer_locate_in_doc`;
    const calculatorSubgoalId = `${turnId}:compound_capability_subgoal:2:scientific-calculator_solve_expression`;
    const docObservationRef = `${turnId}:doc_location_matches`;
    const calculatorObservationRef = `${turnId}:calculator_receipt`;
    const draftRef = `${turnId}:final_answer_draft`;
    const draftText =
      "The docs observation locates the terminal-authority claim, and the calculator observation verifies 19 + 23 = 42 for the numeric check.";
    const artifactLedger = [
      {
        artifact_id: docObservationRef,
        kind: "doc_location_matches",
        payload: {
          schema: "helix.doc_location_matches.v1",
          artifact_id: docObservationRef,
          support_refs: [docObservationRef],
        },
      },
      {
        artifact_id: calculatorObservationRef,
        kind: "calculator_receipt",
        payload: {
          schema: "helix.calculator_receipt.v1",
          artifact_id: calculatorObservationRef,
          result: 42,
        },
      },
      {
        artifact_id: draftRef,
        kind: "final_answer_draft",
        payload: {
          schema: "helix.final_answer_draft.v1",
          artifact_id: draftRef,
          text: draftText,
          answer_text: draftText,
          authority: "llm_post_observation_composer",
          model_step_capability: "model.synthesize_from_compound_subgoal_observations",
          support_refs: [docObservationRef, calculatorObservationRef],
          artifact_refs: [docObservationRef, calculatorObservationRef],
          subgoal_observation_refs: [docObservationRef, calculatorObservationRef],
        },
      },
    ];
    const payload = {
      active_prompt:
        "Use docs-viewer.locate_in_doc to find where terminal authority is discussed, then call scientific-calculator.solve_expression with 19 + 23.",
      canonical_goal_frame: {
        goal_kind: "calculator_solve",
        required_terminal_kind: "workstation_tool_evaluation",
      },
      route_product_contract: {
        source_target: "calculator_stream",
        allowed_terminal_artifact_kinds: ["workstation_tool_evaluation", "typed_failure"],
      },
      compound_capability_contract: {
        schema: "helix.compound_capability_contract.v1",
        requires_all_subgoals: true,
        subgoals: [
          {
            subgoal_id: docsSubgoalId,
            capability_family: "docs_viewer",
            requested_capability: "docs-viewer.locate_in_doc",
            runtime_capability: "docs-viewer.locate_in_doc",
            mandatory: true,
          },
          {
            subgoal_id: calculatorSubgoalId,
            capability_family: "calculator",
            requested_capability: "scientific-calculator.solve_expression",
            runtime_capability: "scientific-calculator.solve_expression",
            mandatory: true,
          },
        ],
      },
      capability_itinerary_execution_state: {
        schema: "helix.capability_itinerary_execution_state.v1",
        applies: true,
        complete: true,
        compound_subgoal_ledger: [
          {
            subgoal_id: docsSubgoalId,
            requested_capability: "docs-viewer.locate_in_doc",
            executed_capability: "docs-viewer.locate_in_doc",
            observation_kind: "doc_location_matches",
            observation_ref: docObservationRef,
            satisfaction: "satisfied",
            rail_status: "complete",
          },
          {
            subgoal_id: calculatorSubgoalId,
            requested_capability: "scientific-calculator.solve_expression",
            executed_capability: "scientific-calculator.solve_expression",
            observation_kind: "calculator_receipt",
            observation_ref: calculatorObservationRef,
            satisfaction: "satisfied",
            rail_status: "complete",
          },
        ],
      },
      current_turn_artifact_ledger: artifactLedger,
    };

    const result = materializeFinalAnswerDraftTerminal({
      turnId,
      payload,
      artifactLedger,
      routeProductContract: payload.route_product_contract,
      finalAnswerDraftRef: draftRef,
    });

    expect(result).toMatchObject({
      ok: true,
      materialized_terminal_artifact_kind: "compound_evidence_synthesis_answer",
    });
    expect(payload.compound_evidence_synthesis_answer).toMatchObject({
      schema: "helix.compound_evidence_synthesis_answer.v1",
      support_refs: [docObservationRef, calculatorObservationRef],
      subgoal_observation_refs: [docObservationRef, calculatorObservationRef],
      model_step_capability: "model.synthesize_from_compound_subgoal_observations",
    });
  });

  it("filters stale missing summaries with artifact-query-index subgoal rails", () => {
    const turnId = "ask:test:compound-stale-missing-summary";
    const docsSubgoalId = `${turnId}:compound_capability_subgoal:1:docs-viewer_locate_in_doc`;
    const calculatorSubgoalId = `${turnId}:compound_capability_subgoal:2:scientific-calculator_solve_expression`;
    const readiness = resolveCompoundCapabilitySynthesisReadiness({
      payload: {
        capability_itinerary_execution_state: {
          schema: "helix.capability_itinerary_execution_state.v1",
          applies: true,
          complete: false,
          compound_subgoal_ledger: [
            {
              subgoal_id: docsSubgoalId,
              requested_capability: "docs-viewer.locate_in_doc",
              runtime_capability: "docs-viewer.locate_in_doc",
              selected_capability: "docs-viewer.locate_in_doc",
              executed_capability: "docs-viewer.locate_in_doc",
              satisfaction: "failed",
              rail_status: "fail_closed",
              rail_failure_code: "subgoal_observation_missing",
            },
            {
              subgoal_id: calculatorSubgoalId,
              requested_capability: "scientific-calculator.solve_expression",
              runtime_capability: "scientific-calculator.solve_expression",
              satisfaction: "pending",
              rail_status: "pending",
              rail_failure_code: "subgoal_observation_missing",
            },
          ],
        },
        compound_capability_contract: {
          schema: "helix.compound_capability_contract.v1",
          requires_all_subgoals: true,
          subgoals: [
            {
              subgoal_id: docsSubgoalId,
              capability_family: "docs_viewer",
              requested_capability: "docs-viewer.locate_in_doc",
              runtime_capability: "docs-viewer.locate_in_doc",
            },
            {
              subgoal_id: calculatorSubgoalId,
              capability_family: "calculator",
              requested_capability: "scientific-calculator.solve_expression",
              runtime_capability: "scientific-calculator.solve_expression",
            },
          ],
        },
        artifact_query_index: {
          compound_subgoal_rail_statuses: [
            {
              subgoal_id: docsSubgoalId,
              requested_capability: "docs-viewer.locate_in_doc",
              runtime_capability: "docs-viewer.locate_in_doc",
              selected_capability: "docs-viewer.locate_in_doc",
              executed_capability: "docs-viewer.locate_in_doc",
              observation_kind: "doc_location_matches",
              observation_ref: "obs:doc-location-runtime",
              support_refs: ["obs:doc-location-runtime"],
              satisfaction: "satisfied",
              rail_status: "complete",
            },
            {
              subgoal_id: calculatorSubgoalId,
              requested_capability: "scientific-calculator.solve_expression",
              runtime_capability: "scientific-calculator.solve_expression",
              satisfaction: "pending",
              rail_status: "pending",
              rail_failure_code: "subgoal_observation_missing",
            },
          ],
          compound_subgoal_missing_summary: {
            missing_compound_subgoal_ids: [docsSubgoalId, calculatorSubgoalId],
            missing_required_capabilities: [
              "docs-viewer.locate_in_doc",
              "scientific-calculator.solve_expression",
            ],
          },
        },
      },
      artifacts: [],
    });

    expect(readiness.complete).toBe(false);
    expect(readiness.missing_compound_subgoal_ids).toEqual([calculatorSubgoalId]);
    expect(readiness.missing_required_capabilities).toEqual(["scientific-calculator.solve_expression"]);
    expect(readiness.support_refs).toContain("obs:doc-location-runtime");
  });

  it("treats runtime-satisfied contract subgoals as complete despite stale broad itinerary families", () => {
    const turnId = "ask:test:compound-stale-broad-family";
    const docsSubgoalId = `${turnId}:compound_capability_subgoal:1:docs-viewer_locate_in_doc`;
    const calculatorSubgoalId = `${turnId}:compound_capability_subgoal:2:scientific-calculator_solve_expression`;
    const compoundRows = [
      {
        subgoal_id: docsSubgoalId,
        requested_capability: "docs-viewer.locate_in_doc",
        runtime_capability: "docs-viewer.locate_in_doc",
        selected_capability: "docs-viewer.locate_in_doc",
        executed_capability: "docs-viewer.locate_in_doc",
        observation_kind: "doc_location_matches",
        observation_ref: "obs:doc-location-runtime",
        support_refs: ["obs:doc-location-runtime"],
        satisfaction: "satisfied",
        rail_status: "complete",
      },
      {
        subgoal_id: calculatorSubgoalId,
        requested_capability: "scientific-calculator.solve_expression",
        runtime_capability: "scientific-calculator.solve_expression",
        selected_capability: "scientific-calculator.solve_expression",
        executed_capability: "scientific-calculator.solve_expression",
        observation_kind: "calculator_receipt",
        observation_ref: "obs:calculator-runtime",
        support_refs: ["obs:calculator-runtime"],
        satisfaction: "satisfied",
        rail_status: "complete",
      },
    ];
    const readiness = resolveCompoundCapabilitySynthesisReadiness({
      payload: {
        capability_itinerary: {
          schema: "helix.capability_itinerary.v1",
          terminal_success_criteria: {
            requires_post_observation_synthesis: true,
            required_observation_families: ["docs_viewer", "calculator", "scholarly_research"],
            required_capabilities: ["docs-viewer.locate_in_doc", "scientific-calculator.solve_expression"],
          },
        },
        capability_itinerary_execution_state: {
          schema: "helix.capability_itinerary_execution_state.v1",
          applies: true,
          complete: false,
          required_observation_families: ["docs_viewer", "calculator", "scholarly_research"],
          observed_families: ["docs_viewer", "calculator"],
          missing_observation_families: ["scholarly_research"],
          compound_subgoal_ledger: compoundRows,
        },
        compound_capability_contract: {
          schema: "helix.compound_capability_contract.v1",
          requires_all_subgoals: true,
          subgoals: [
            {
              subgoal_id: docsSubgoalId,
              capability_family: "docs_viewer",
              requested_capability: "docs-viewer.locate_in_doc",
              runtime_capability: "docs-viewer.locate_in_doc",
              mandatory: true,
            },
            {
              subgoal_id: calculatorSubgoalId,
              capability_family: "calculator",
              requested_capability: "scientific-calculator.solve_expression",
              runtime_capability: "scientific-calculator.solve_expression",
              mandatory: true,
            },
          ],
        },
        artifact_query_index: {
          compound_subgoal_rail_statuses: compoundRows,
          compound_subgoal_missing_summary: {
            missing_compound_subgoal_ids: [],
            missing_required_capabilities: [],
            complete: false,
          },
        },
      },
      artifacts: [],
    });

    expect(readiness).toMatchObject({
      applies: true,
      complete: true,
      synthesis_required: true,
      required_terminal_kind: "doc_evidence_synthesis_answer",
      synthesis_terminal_kind: "doc_evidence_synthesis_answer",
      missing_required_capabilities: [],
      incomplete_compound_subgoal_ids: [],
    });
    expect(readiness.support_refs).toEqual(["obs:doc-location-runtime", "obs:calculator-runtime"]);
  });

  it("recovers synthesis readiness from ledger-only compound itinerary artifacts", () => {
    const turnId = "ask:test:compound-synthesis-ledger-only-state";
    const docsSubgoalId = `${turnId}:compound_capability_subgoal:1:docs-viewer_locate_in_doc`;
    const calculatorSubgoalId = `${turnId}:compound_capability_subgoal:2:scientific-calculator_solve_expression`;
    const capabilityItinerary = {
      schema: "helix.capability_itinerary.v1",
      terminal_success_criteria: {
        requires_post_observation_synthesis: true,
        compound_terminal_policy: "synthesize_from_satisfied_subgoal_observations",
        required_observation_families: ["docs_viewer", "calculator"],
        required_capabilities: ["docs-viewer.locate_in_doc", "scientific-calculator.solve_expression"],
        required_terminal_kind: "doc_evidence_synthesis_answer",
        allowed_terminal_artifact_kinds: ["doc_evidence_synthesis_answer", "model_synthesized_answer"],
        forbidden_terminal_artifact_kinds: ["tool_receipt", "calculator_receipt"],
      },
    };
    const compoundContract = {
      schema: "helix.compound_capability_contract.v1",
      requires_all_subgoals: true,
      subgoals: [
        {
          subgoal_id: docsSubgoalId,
          capability_family: "docs_viewer",
          requested_capability: "docs-viewer.locate_in_doc",
          runtime_capability: "docs-viewer.locate_in_doc",
        },
        {
          subgoal_id: calculatorSubgoalId,
          capability_family: "calculator",
          requested_capability: "scientific-calculator.solve_expression",
          runtime_capability: "scientific-calculator.solve_expression",
        },
      ],
    };
    const executionState = {
      schema: "helix.capability_itinerary_execution_state.v1",
      applies: true,
      complete: true,
      required_observation_families: ["docs_viewer", "calculator"],
      observed_families: ["docs_viewer", "calculator"],
      compound_subgoal_ledger: [
        {
          subgoal_id: docsSubgoalId,
          requested_capability: "docs-viewer.locate_in_doc",
          executed_capability: "docs-viewer.locate_in_doc",
          observation_kind: "doc_location_matches",
          observation_ref: "obs:doc-location",
          satisfaction: "satisfied",
          rail_status: "complete",
        },
        {
          subgoal_id: calculatorSubgoalId,
          requested_capability: "scientific-calculator.solve_expression",
          executed_capability: "scientific-calculator.solve_expression",
          observation_kind: "calculator_receipt",
          observation_ref: "obs:calculator",
          satisfaction: "satisfied",
          rail_status: "complete",
        },
      ],
    };
    const readiness = resolveCompoundCapabilitySynthesisReadiness({
      payload: {
        current_turn_artifact_ledger: [
          {
            artifact_id: `${turnId}:capability_itinerary`,
            kind: "capability_itinerary",
            payload: capabilityItinerary,
          },
          {
            artifact_id: `${turnId}:compound_capability_contract`,
            kind: "compound_capability_contract",
            payload: compoundContract,
          },
          {
            artifact_id: `${turnId}:capability_itinerary_execution_state`,
            kind: "capability_itinerary_execution_state",
            payload: executionState,
          },
          {
            artifact_id: "obs:doc-location",
            kind: "doc_location_matches",
            payload: { schema: "helix.doc_location_matches.v1" },
          },
          {
            artifact_id: "obs:calculator",
            kind: "calculator_receipt",
            payload: { schema: "helix.calculator_receipt.v1" },
          },
        ],
      },
    });

    expect(readiness).toMatchObject({
      applies: true,
      complete: true,
      synthesis_required: true,
      has_docs_subgoal: true,
      goal_kind: "doc_evidence_synthesis",
      required_terminal_kind: "doc_evidence_synthesis_answer",
      synthesis_terminal_kind: "doc_evidence_synthesis_answer",
    });
    expect(readiness.support_refs).toEqual(["obs:doc-location", "obs:calculator"]);
  });

  it("does not require synthesis for failed compound subgoals", () => {
    const readiness = resolveCompoundCapabilitySynthesisReadiness({
      payload: {
        capability_itinerary_execution_state: {
          schema: "helix.capability_itinerary_execution_state.v1",
          applies: true,
          complete: false,
          compound_subgoal_ledger: [
            {
              requested_capability: "docs-viewer.locate_in_doc",
              observation_ref: "obs:doc-location",
              satisfaction: "satisfied",
              rail_status: "complete",
            },
            {
              requested_capability: "scientific-calculator.solve_expression",
              observation_ref: null,
              satisfaction: "failed",
              rail_status: "fail_closed",
              rail_failure_code: "invalid_arg:latex_is_prose",
            },
          ],
        },
      },
      artifacts: [],
    });

    expect(readiness.has_failed_subgoal).toBe(true);
    expect(readiness.synthesis_required).toBe(false);
  });

  it("does not borrow support refs from failed or pending compound subgoals", () => {
    const readiness = resolveCompoundCapabilitySynthesisReadiness({
      payload: {
        capability_itinerary_execution_state: {
          schema: "helix.capability_itinerary_execution_state.v1",
          applies: true,
          complete: false,
          compound_subgoal_ledger: [
            {
              requested_capability: "internet_search.web_research",
              executed_capability: "internet_search.web_research",
              observation_kind: "internet_search_observation",
              observation_ref: "obs:internet-search",
              support_refs: ["obs:internet-search-support"],
              satisfaction: "satisfied",
              rail_status: "complete",
            },
            {
              requested_capability: "helix_ask.reflect_theory_context",
              executed_capability: "helix_ask.reflect_theory_context",
              observation_kind: "theory_context_reflection",
              observation_ref: "obs:failed-reflection",
              support_refs: ["obs:failed-reflection-support"],
              satisfaction: "failed",
              rail_status: "fail_closed",
              rail_failure_code: "input_binding_missing",
            },
            {
              requested_capability: "scientific-calculator.solve_expression",
              selected_capability: "scientific-calculator.solve_expression",
              observation_ref: "obs:pending-calculator",
              support_refs: ["obs:pending-calculator-support"],
              satisfaction: "pending",
              rail_status: "pending",
            },
          ],
        },
      },
      artifacts: [],
    });

    expect(readiness.has_failed_subgoal).toBe(true);
    expect(readiness.synthesis_required).toBe(false);
    expect(readiness.support_refs).toEqual(["obs:internet-search", "obs:internet-search-support"]);
    expect(readiness.support_refs).not.toContain("obs:failed-reflection");
    expect(readiness.support_refs).not.toContain("obs:failed-reflection-support");
    expect(readiness.support_refs).not.toContain("obs:pending-calculator");
    expect(readiness.support_refs).not.toContain("obs:pending-calculator-support");
  });

  it("treats satisfied compound rows without observation refs as incomplete", () => {
    const readiness = resolveCompoundCapabilitySynthesisReadiness({
      payload: {
        capability_itinerary_execution_state: {
          schema: "helix.capability_itinerary_execution_state.v1",
          applies: true,
          complete: true,
          compound_subgoal_ledger: [
            {
              requested_capability: "internet_search.web_research",
              executed_capability: "internet_search.web_research",
              observation_kind: "internet_search_observation",
              observation_ref: "obs:internet-search",
              satisfaction: "satisfied",
              rail_status: "complete",
            },
            {
              requested_capability: "helix_ask.reflect_theory_context",
              executed_capability: "helix_ask.reflect_theory_context",
              observation_kind: "theory_context_reflection",
              observation_ref: null,
              satisfaction: "satisfied",
              rail_status: "complete",
              terminal_contribution_kind: "model_synthesized_answer",
            },
          ],
        },
      },
      artifacts: [],
    });

    expect(readiness).toMatchObject({
      applies: true,
      complete: false,
      synthesis_required: false,
      has_failed_subgoal: false,
      incomplete_compound_subgoal_ids: [],
      missing_required_capabilities: ["helix_ask.reflect_theory_context"],
    });
    expect(readiness.support_refs).toEqual(["obs:internet-search"]);
  });

  it("blocks synthesis when rail mirrors prove a required subgoal was dropped", () => {
    const turnId = "ask:test:compound-dropped-subgoal-rail-readiness";
    const workspaceSubgoalId = `${turnId}:compound_capability_subgoal:1:workspace_os_status`;
    const calculatorSubgoalId = `${turnId}:compound_capability_subgoal:2:scientific-calculator_solve_expression`;
    const readiness = resolveCompoundCapabilitySynthesisReadiness({
      payload: {
        capability_itinerary_execution_state: {
          schema: "helix.capability_itinerary_execution_state.v1",
          applies: true,
          complete: true,
          required_observation_families: ["workspace_diagnostic", "calculator"],
          compound_subgoal_ledger: [
            {
              subgoal_id: workspaceSubgoalId,
              requested_capability: "workspace_os.status",
              executed_capability: "workspace_os.status",
              observation_kind: "workspace_os_status_observation",
              observation_ref: "obs:workspace-status",
              satisfaction: "satisfied",
              rail_status: "complete",
            },
          ],
        },
        compound_subgoal_rail_statuses: [
          {
            subgoal_id: workspaceSubgoalId,
            requested_capability: "workspace_os.status",
            executed_capability: "workspace_os.status",
            observation_kind: "workspace_os_status_observation",
            observation_ref: "obs:workspace-status",
            satisfaction: "satisfied",
            rail_status: "complete",
          },
          {
            subgoal_id: calculatorSubgoalId,
            requested_capability: "scientific-calculator.solve_expression",
            runtime_capability: "scientific-calculator.solve_expression",
            selected_capability: null,
            executed_capability: null,
            required_observation_kinds: ["calculator_receipt"],
            required_terminal_kind: "workstation_tool_evaluation",
            observation_kind: null,
            observation_ref: null,
            satisfaction: "missing",
            terminal_contribution_kind: "workstation_tool_evaluation",
            rail_status: "fail_closed",
            first_broken_rail: "capability_execution",
            rail_failure_code: "compound_subgoal_dropped",
            repair_target: "agent_step_selection",
          },
        ],
        compound_subgoal_missing_summary: {
          missing_compound_subgoal_ids: [calculatorSubgoalId],
          missing_required_capabilities: ["scientific-calculator.solve_expression"],
          next_missing_subgoal_id: calculatorSubgoalId,
          complete: false,
        },
      },
      artifacts: [],
    });

    expect(readiness).toMatchObject({
      applies: true,
      complete: false,
      has_failed_subgoal: true,
      synthesis_required: false,
      missing_compound_subgoal_ids: [calculatorSubgoalId],
      missing_required_capabilities: ["scientific-calculator.solve_expression"],
      incomplete_compound_subgoal_ids: [calculatorSubgoalId],
    });
    expect(readiness.support_refs).toEqual(["obs:workspace-status"]);
    expect(readiness.terminal_contribution_kinds).toEqual(["workstation_tool_evaluation"]);
  });

  it("does not trust a stale complete mirror when any compound subgoal is still pending", () => {
    const turnId = "ask:test:compound-pending-subgoal-stale-complete";
    const workspaceSubgoalId = `${turnId}:compound_capability_subgoal:1:workspace_os_status`;
    const calculatorSubgoalId = `${turnId}:compound_capability_subgoal:2:scientific-calculator_solve_expression`;
    const readiness = resolveCompoundCapabilitySynthesisReadiness({
      payload: {
        capability_itinerary_execution_state: {
          schema: "helix.capability_itinerary_execution_state.v1",
          applies: true,
          complete: true,
          required_observation_families: ["workspace_diagnostic", "calculator"],
          compound_subgoal_ledger: [
            {
              subgoal_id: workspaceSubgoalId,
              requested_capability: "workspace_os.status",
              executed_capability: "workspace_os.status",
              observation_kind: "workspace_os_status_observation",
              observation_ref: "obs:workspace-status",
              satisfaction: "satisfied",
              rail_status: "complete",
            },
            {
              subgoal_id: calculatorSubgoalId,
              requested_capability: "scientific-calculator.solve_expression",
              selected_capability: "scientific-calculator.solve_expression",
              executed_capability: null,
              observation_kind: null,
              observation_ref: null,
              satisfaction: "pending",
              rail_status: "pending",
              terminal_contribution_kind: "workstation_tool_evaluation",
            },
          ],
        },
      },
      artifacts: [],
    });

    expect(readiness).toMatchObject({
      applies: true,
      complete: false,
      synthesis_required: false,
    });
    expect(readiness.support_refs).toEqual(["obs:workspace-status"]);
    expect(readiness.terminal_contribution_kinds).toEqual(["workstation_tool_evaluation"]);
  });

  it("does not trust a stale complete mirror when the contract has an unrepresented mandatory subgoal", () => {
    const turnId = "ask:test:compound-contract-subgoal-missing-from-ledger";
    const workspaceSubgoalId = `${turnId}:compound_capability_subgoal:1:workspace_os_status`;
    const calculatorSubgoalId = `${turnId}:compound_capability_subgoal:2:scientific-calculator_solve_expression`;
    const readiness = resolveCompoundCapabilitySynthesisReadiness({
      payload: {
        compound_capability_contract: {
          schema: "helix.compound_capability_contract.v1",
          requires_all_subgoals: true,
          subgoals: [
            {
              subgoal_id: workspaceSubgoalId,
              requested_capability: "workspace_os.status",
              runtime_capability: "workspace_os.status",
              required_terminal_kind: "model_synthesized_answer",
              terminal_contribution_kind: "model_synthesized_answer",
              mandatory: true,
            },
            {
              subgoal_id: calculatorSubgoalId,
              requested_capability: "scientific-calculator.solve_expression",
              runtime_capability: "scientific-calculator.solve_expression",
              required_terminal_kind: "workstation_tool_evaluation",
              terminal_contribution_kind: "workstation_tool_evaluation",
              mandatory: true,
            },
          ],
        },
        capability_itinerary_execution_state: {
          schema: "helix.capability_itinerary_execution_state.v1",
          applies: true,
          complete: true,
          required_observation_families: ["workspace_diagnostic", "calculator"],
          compound_subgoal_ledger: [
            {
              subgoal_id: workspaceSubgoalId,
              requested_capability: "workspace_os.status",
              executed_capability: "workspace_os.status",
              observation_kind: "workspace_os_status_observation",
              observation_ref: "obs:workspace-status",
              satisfaction: "satisfied",
              rail_status: "complete",
              terminal_contribution_kind: "model_synthesized_answer",
            },
          ],
        },
      },
      artifacts: [],
    });

    expect(readiness).toMatchObject({
      applies: true,
      complete: false,
      has_failed_subgoal: true,
      synthesis_required: false,
      missing_compound_subgoal_ids: [calculatorSubgoalId],
      missing_required_capabilities: ["scientific-calculator.solve_expression"],
      incomplete_compound_subgoal_ids: [calculatorSubgoalId],
    });
    expect(readiness.support_refs).toEqual(["obs:workspace-status"]);
    expect(readiness.terminal_contribution_kinds).toEqual([
      "model_synthesized_answer",
      "workstation_tool_evaluation",
    ]);
  });

  it("honors compound contract synthesis policy when terminal criteria mirror is absent", () => {
    const turnId = "ask:test:compound-contract-policy-without-terminal-criteria";
    const catalogSubgoalId = `${turnId}:compound_capability_subgoal:1:helix_ask_inspect_capability_catalog`;
    const workspaceSubgoalId = `${turnId}:compound_capability_subgoal:2:workspace_os_status`;
    const readiness = resolveCompoundCapabilitySynthesisReadiness({
      payload: {
        compound_capability_contract: {
          schema: "helix.compound_capability_contract.v1",
          requires_all_subgoals: true,
          terminal_policy: "synthesize_from_satisfied_subgoal_observations",
          subgoals: [
            {
              subgoal_id: catalogSubgoalId,
              requested_capability: "helix_ask.inspect_capability_catalog",
              runtime_capability: "helix_ask.inspect_capability_catalog",
              required_terminal_kind: "capability_help_summary",
              terminal_contribution_kind: "capability_help_summary",
              mandatory: true,
            },
            {
              subgoal_id: workspaceSubgoalId,
              requested_capability: "workspace_os.status",
              runtime_capability: "workspace_os.status",
              required_terminal_kind: "model_synthesized_answer",
              terminal_contribution_kind: "model_synthesized_answer",
              mandatory: true,
            },
          ],
        },
        capability_itinerary_execution_state: {
          schema: "helix.capability_itinerary_execution_state.v1",
          applies: false,
          complete: true,
          compound_subgoal_ledger: [
            {
              subgoal_id: catalogSubgoalId,
              requested_capability: "helix_ask.inspect_capability_catalog",
              executed_capability: "helix_ask.inspect_capability_catalog",
              observation_kind: "capability_registry",
              observation_ref: "obs:capability-registry",
              satisfaction: "satisfied",
              rail_status: "complete",
              terminal_contribution_kind: "capability_help_summary",
            },
            {
              subgoal_id: workspaceSubgoalId,
              requested_capability: "workspace_os.status",
              executed_capability: "workspace_os.status",
              observation_kind: "workspace_os_status_observation",
              observation_ref: "obs:workspace-status",
              satisfaction: "satisfied",
              rail_status: "complete",
              terminal_contribution_kind: "model_synthesized_answer",
            },
          ],
        },
      },
      artifacts: [],
    });

    expect(readiness).toMatchObject({
      applies: true,
      complete: true,
      synthesis_required: true,
      goal_kind: "compound_evidence_synthesis",
      required_terminal_kind: "compound_evidence_synthesis_answer",
    });
    expect(readiness.support_refs).toEqual(["obs:capability-registry", "obs:workspace-status"]);
    expect(readiness.terminal_contribution_kinds).toEqual([
      "capability_help_summary",
      "model_synthesized_answer",
    ]);
  });

  it("prefers a rebuilt observation-backed ledger over stale complete mirrors", () => {
    const turnId = "ask:test:compound-rebuilt-ledger-beats-stale-complete";
    const catalogSubgoalId = `${turnId}:compound_capability_subgoal:1:helix_ask_inspect_capability_catalog`;
    const workspaceSubgoalId = `${turnId}:compound_capability_subgoal:2:workspace_os_status`;
    const capabilityItinerary = {
      schema: "helix.capability_itinerary.v1",
      turn_id: turnId,
      terminal_success_criteria: {
        requires_post_observation_synthesis: true,
        required_observation_families: ["capability_catalog", "workspace_diagnostic"],
      },
      compound_capability_contract: {
        schema: "helix.compound_capability_contract.v1",
        requires_all_subgoals: true,
        terminal_policy: "synthesize_from_satisfied_subgoal_observations",
        subgoals: [
          {
            subgoal_id: catalogSubgoalId,
            requested_capability: "helix_ask.inspect_capability_catalog",
            runtime_capability: "helix_ask.inspect_capability_catalog",
            required_observation_kinds: ["capability_registry"],
            required_terminal_kind: "capability_help_summary",
            terminal_contribution_kind: "capability_help_summary",
            mandatory: true,
          },
          {
            subgoal_id: workspaceSubgoalId,
            requested_capability: "workspace_os.status",
            runtime_capability: "workspace_os.status",
            required_observation_kinds: ["workspace_os_status_observation"],
            required_terminal_kind: "model_synthesized_answer",
            terminal_contribution_kind: "model_synthesized_answer",
            mandatory: true,
          },
        ],
      },
    };
    const readiness = resolveCompoundCapabilitySynthesisReadiness({
      payload: {
        capability_itinerary: capabilityItinerary,
        capability_itinerary_execution_state: {
          schema: "helix.capability_itinerary_execution_state.v1",
          applies: true,
          complete: false,
          required_observation_families: ["capability_catalog", "workspace_diagnostic"],
          compound_subgoal_ledger: [
            {
              subgoal_id: catalogSubgoalId,
              requested_capability: "helix_ask.inspect_capability_catalog",
              selected_capability: "helix_ask.inspect_capability_catalog",
              executed_capability: null,
              observation_ref: null,
              rail_status: "complete",
            },
            {
              subgoal_id: workspaceSubgoalId,
              requested_capability: "workspace_os.status",
              selected_capability: "workspace_os.status",
              executed_capability: null,
              observation_ref: null,
              rail_status: "complete",
            },
          ],
        },
      },
      artifacts: [
        {
          artifact_id: "call:capability-catalog",
          kind: "runtime_tool_call",
          payload: {
            capability_key: "helix_ask.inspect_capability_catalog",
            compound_subgoal_id: catalogSubgoalId,
            args: {},
          },
        },
        {
          artifact_id: "runtime:capability-catalog",
          kind: "runtime_tool_observation",
          payload: {
            capability_key: "helix_ask.inspect_capability_catalog",
            compound_subgoal_id: catalogSubgoalId,
            status: "completed",
          },
        },
        {
          artifact_id: "obs:capability-registry",
          kind: "capability_registry",
          payload: {
            schema: "helix.capability_registry.v1",
            capability_key: "helix_ask.inspect_capability_catalog",
            compound_subgoal_id: catalogSubgoalId,
          },
        },
        {
          artifact_id: "call:workspace-status",
          kind: "runtime_tool_call",
          payload: {
            capability_key: "workspace_os.status",
            compound_subgoal_id: workspaceSubgoalId,
            args: {},
          },
        },
        {
          artifact_id: "runtime:workspace-status",
          kind: "runtime_tool_observation",
          payload: {
            capability_key: "workspace_os.status",
            compound_subgoal_id: workspaceSubgoalId,
            status: "completed",
          },
        },
        {
          artifact_id: "obs:workspace-status",
          kind: "workspace_os_status_observation",
          payload: {
            schema: "helix.workspace_os_status_observation.v1",
            capability_key: "workspace_os.status",
            compound_subgoal_id: workspaceSubgoalId,
          },
        },
      ],
    });

    expect(readiness).toMatchObject({
      applies: true,
      complete: true,
      synthesis_required: true,
      has_failed_subgoal: false,
      required_terminal_kind: "compound_evidence_synthesis_answer",
    });
    expect(readiness.support_refs).toEqual(["obs:capability-registry", "obs:workspace-status"]);
  });

  it("treats a contract-only compound with no subgoal rows as applicable but incomplete", () => {
    const turnId = "ask:test:compound-contract-only-no-ledger";
    const readiness = resolveCompoundCapabilitySynthesisReadiness({
      payload: {
        compound_capability_contract: {
          schema: "helix.compound_capability_contract.v1",
          requires_all_subgoals: true,
          terminal_policy: "synthesize_from_satisfied_subgoal_observations",
          subgoals: [
            {
              subgoal_id: `${turnId}:compound_capability_subgoal:1:docs-viewer_locate_in_doc`,
              requested_capability: "docs-viewer.locate_in_doc",
              runtime_capability: "docs-viewer.locate_in_doc",
              required_terminal_kind: "doc_location_matches",
              terminal_contribution_kind: "doc_location_matches",
              mandatory: true,
            },
            {
              subgoal_id: `${turnId}:compound_capability_subgoal:2:scientific-calculator_solve_expression`,
              requested_capability: "scientific-calculator.solve_expression",
              runtime_capability: "scientific-calculator.solve_expression",
              required_terminal_kind: "workstation_tool_evaluation",
              terminal_contribution_kind: "workstation_tool_evaluation",
              mandatory: true,
            },
          ],
        },
      },
      artifacts: [],
    });

    expect(readiness).toMatchObject({
      applies: true,
      complete: false,
      has_failed_subgoal: true,
      synthesis_required: false,
      goal_kind: "doc_evidence_synthesis",
      required_terminal_kind: "doc_evidence_synthesis_answer",
      missing_compound_subgoal_ids: [
        `${turnId}:compound_capability_subgoal:1:docs-viewer_locate_in_doc`,
        `${turnId}:compound_capability_subgoal:2:scientific-calculator_solve_expression`,
      ],
      missing_required_capabilities: [
        "docs-viewer.locate_in_doc",
        "scientific-calculator.solve_expression",
      ],
      incomplete_compound_subgoal_ids: [
        `${turnId}:compound_capability_subgoal:1:docs-viewer_locate_in_doc`,
        `${turnId}:compound_capability_subgoal:2:scientific-calculator_solve_expression`,
      ],
    });
    expect(readiness.support_refs).toEqual([]);
    expect(readiness.terminal_contribution_kinds).toEqual([
      "doc_location_matches",
      "workstation_tool_evaluation",
    ]);
  });

  it("includes resolved bound input refs in synthesis support refs", () => {
    const turnId = "ask:test:compound-bound-support-refs";
    const researchSubgoalId = `${turnId}:compound_capability_subgoal:1:internet_search_web_research`;
    const calculatorSubgoalId = `${turnId}:compound_capability_subgoal:2:scientific-calculator_solve_expression`;
    const readiness = resolveCompoundCapabilitySynthesisReadiness({
      payload: {
        capability_itinerary_execution_state: {
          schema: "helix.capability_itinerary_execution_state.v1",
          applies: true,
          complete: true,
          compound_subgoal_ledger: [
            {
              subgoal_id: researchSubgoalId,
              requested_capability: "internet_search.web_research",
              executed_capability: "internet_search.web_research",
              observation_kind: "internet_search_observation",
              observation_ref: "obs:research",
              satisfaction: "satisfied",
              rail_status: "complete",
            },
            {
              subgoal_id: calculatorSubgoalId,
              requested_capability: "scientific-calculator.solve_expression",
              executed_capability: "scientific-calculator.solve_expression",
              observation_kind: "calculator_receipt",
              observation_ref: "obs:calculator",
              bound_input_refs: [
                {
                  binding_id: `${calculatorSubgoalId}:input_binding:1`,
                  arg_name: "support_refs",
                  binding_kind: "support_ref",
                  from_subgoal_id: researchSubgoalId,
                  from_capability: "internet_search.web_research",
                  ref: "obs:research-selected-passage",
                },
              ],
              satisfaction: "satisfied",
              rail_status: "complete",
            },
          ],
        },
      },
      artifacts: [],
    });

    expect(readiness.support_refs).toEqual([
      "obs:research",
      "obs:calculator",
      "obs:research-selected-passage",
    ]);
  });

  it("requires synthesis for complete family-based compound itineraries without a draft", () => {
    const turnId = "ask:test:family-compound-synthesis";
    const readiness = resolveCompoundCapabilitySynthesisReadiness({
      payload: {
        capability_itinerary: {
          schema: "helix.capability_itinerary.v1",
          turn_id: turnId,
          terminal_success_criteria: {
            requires_post_observation_synthesis: true,
            required_observation_families: ["scholarly_research", "theory_locator"],
          },
        },
      },
      artifacts: [
        {
          artifact_id: "obs:scholarly",
          kind: "scholarly_research_observation",
          payload: { schema: "helix.scholarly_research_observation.v1" },
        },
        {
          artifact_id: "obs:theory",
          kind: "helix_theory_context_reflection_tool_receipt",
          payload: { schema: "helix.theory_context_reflection_tool_receipt.v1" },
        },
      ],
    });

    expect(readiness).toMatchObject({
      applies: true,
      complete: true,
      synthesis_required: true,
      has_final_answer_draft: false,
      goal_kind: "compound_research_locator",
      required_terminal_kind: "compound_research_locator_answer",
      synthesis_terminal_kind: "compound_research_locator_answer",
    });
    expect(readiness.support_refs).toEqual(["obs:scholarly", "obs:theory"]);
  });

  it("requires compound evidence synthesis for non-doc heterogeneous compound observations", () => {
    const readiness = resolveCompoundCapabilitySynthesisReadiness({
      payload: {
        capability_itinerary_execution_state: {
          schema: "helix.capability_itinerary_execution_state.v1",
          applies: true,
          complete: true,
          compound_subgoal_ledger: [
            {
              requested_capability: "internet_search.web_research",
              executed_capability: "internet_search.web_research",
              observation_kind: "internet_search_observation",
              observation_ref: "obs:web",
              satisfaction: "satisfied",
              rail_status: "complete",
              terminal_contribution_kind: "model_synthesized_answer",
            },
            {
              requested_capability: "helix_ask.reflect_theory_context",
              executed_capability: "helix_ask.reflect_theory_context",
              observation_kind: "helix_theory_context_reflection_tool_receipt",
              observation_ref: "obs:reflection",
              satisfaction: "satisfied",
              rail_status: "complete",
              terminal_contribution_kind: "model_synthesized_answer",
            },
            {
              requested_capability: "scientific-calculator.solve_expression",
              executed_capability: "scientific-calculator.solve_expression",
              observation_kind: "calculator_receipt",
              observation_ref: "obs:calculator",
              satisfaction: "satisfied",
              rail_status: "complete",
              terminal_contribution_kind: "workstation_tool_evaluation",
            },
          ],
        },
      },
      artifacts: [],
    });

    expect(readiness).toMatchObject({
      applies: true,
      complete: true,
      synthesis_required: true,
      has_docs_subgoal: false,
      goal_kind: "compound_evidence_synthesis",
      required_terminal_kind: "compound_evidence_synthesis_answer",
      synthesis_terminal_kind: "compound_evidence_synthesis_answer",
    });
    expect(readiness.support_refs).toEqual(["obs:web", "obs:reflection", "obs:calculator"]);
    expect(readiness.terminal_contribution_kinds).toEqual([
      "model_synthesized_answer",
      "workstation_tool_evaluation",
    ]);
  });

  it("requires compound evidence synthesis for scholarly research plus reflection plus calculator observations", () => {
    const readiness = resolveCompoundCapabilitySynthesisReadiness({
      payload: {
        capability_itinerary_execution_state: {
          schema: "helix.capability_itinerary_execution_state.v1",
          applies: true,
          complete: true,
          compound_subgoal_ledger: [
            {
              requested_capability: "scholarly-research.lookup_papers",
              executed_capability: "scholarly-research.lookup_papers",
              observation_kind: "scholarly_research_observation",
              observation_ref: "obs:scholarly",
              satisfaction: "satisfied",
              rail_status: "complete",
              terminal_contribution_kind: "scholarly_research_answer",
            },
            {
              requested_capability: "helix_ask.reflect_theory_context",
              executed_capability: "helix_ask.reflect_theory_context",
              observation_kind: "helix_theory_context_reflection_tool_receipt",
              observation_ref: "obs:reflection",
              satisfaction: "satisfied",
              rail_status: "complete",
              terminal_contribution_kind: "model_synthesized_answer",
            },
            {
              requested_capability: "scientific-calculator.solve_expression",
              executed_capability: "scientific-calculator.solve_expression",
              observation_kind: "calculator_receipt",
              observation_ref: "obs:calculator",
              satisfaction: "satisfied",
              rail_status: "complete",
              terminal_contribution_kind: "workstation_tool_evaluation",
            },
          ],
        },
      },
      artifacts: [],
    });

    expect(readiness).toMatchObject({
      applies: true,
      complete: true,
      synthesis_required: true,
      has_docs_subgoal: false,
      goal_kind: "compound_evidence_synthesis",
      required_terminal_kind: "compound_evidence_synthesis_answer",
      synthesis_terminal_kind: "compound_evidence_synthesis_answer",
    });
    expect(readiness.support_refs).toEqual(["obs:scholarly", "obs:reflection", "obs:calculator"]);
    expect(readiness.terminal_contribution_kinds).toEqual([
      "scholarly_research_answer",
      "model_synthesized_answer",
      "workstation_tool_evaluation",
    ]);
  });

  it("does not let stale generic terminal suppress non-doc compound synthesis without subgoal support refs", () => {
    const ledger = [
      {
        requested_capability: "internet_search.web_research",
        executed_capability: "internet_search.web_research",
        observation_kind: "internet_search_observation",
        observation_ref: "obs:web",
        satisfaction: "satisfied",
        rail_status: "complete",
        terminal_contribution_kind: "model_synthesized_answer",
      },
      {
        requested_capability: "helix_ask.reflect_theory_context",
        executed_capability: "helix_ask.reflect_theory_context",
        observation_kind: "helix_theory_context_reflection_tool_receipt",
        observation_ref: "obs:reflection",
        satisfaction: "satisfied",
        rail_status: "complete",
        terminal_contribution_kind: "model_synthesized_answer",
      },
      {
        requested_capability: "scientific-calculator.solve_expression",
        executed_capability: "scientific-calculator.solve_expression",
        observation_kind: "calculator_receipt",
        observation_ref: "obs:calculator",
        satisfaction: "satisfied",
        rail_status: "complete",
        terminal_contribution_kind: "workstation_tool_evaluation",
      },
    ];
    const readiness = resolveCompoundCapabilitySynthesisReadiness({
      payload: {
        capability_itinerary_execution_state: {
          schema: "helix.capability_itinerary_execution_state.v1",
          applies: true,
          complete: true,
          compound_subgoal_ledger: ledger,
        },
        model_synthesized_answer: {
          text: "This terminal predates the complete compound evidence set.",
          support_refs: ["obs:web"],
        },
      },
      artifacts: [],
    });

    expect(readiness).toMatchObject({
      applies: true,
      complete: true,
      has_docs_subgoal: false,
      has_materialized_terminal_artifact: false,
      synthesis_required: true,
      required_terminal_kind: "compound_evidence_synthesis_answer",
    });
    expect(readiness.support_refs).toEqual(["obs:web", "obs:reflection", "obs:calculator"]);
  });

  it("accepts a materialized non-doc compound terminal only when it covers all subgoal refs", () => {
    const ledger = [
      {
        requested_capability: "helix_ask.inspect_capability_catalog",
        executed_capability: "helix_ask.inspect_capability_catalog",
        observation_kind: "capability_registry",
        observation_ref: "obs:capability-registry",
        satisfaction: "satisfied",
        rail_status: "complete",
      },
      {
        requested_capability: "workspace_os.status",
        executed_capability: "workspace_os.status",
        observation_kind: "workspace_os_status_observation",
        observation_ref: "obs:workspace-status",
        satisfaction: "satisfied",
        rail_status: "complete",
      },
    ];
    const readiness = resolveCompoundCapabilitySynthesisReadiness({
      payload: {
        capability_itinerary_execution_state: {
          schema: "helix.capability_itinerary_execution_state.v1",
          applies: true,
          complete: true,
          compound_subgoal_ledger: ledger,
        },
        compound_evidence_synthesis_answer: {
          text: "Catalog plus workspace status were synthesized from both observations.",
          support_refs: ["obs:capability-registry", "obs:workspace-status"],
        },
      },
      artifacts: [],
    });

    expect(readiness).toMatchObject({
      applies: true,
      complete: true,
      has_materialized_terminal_artifact: true,
      synthesis_required: false,
      required_terminal_kind: "compound_evidence_synthesis_answer",
    });
    expect(readiness.support_refs).toEqual(["obs:capability-registry", "obs:workspace-status"]);
  });

  it("requires synthesis from visual capture and calculator observations together", () => {
    const readiness = resolveCompoundCapabilitySynthesisReadiness({
      payload: {
        capability_itinerary_execution_state: {
          schema: "helix.capability_itinerary_execution_state.v1",
          applies: true,
          complete: true,
          compound_subgoal_ledger: [
            {
              requested_capability: "image_lens.inspect",
              selected_capability: "situation-room.describe_visual_capture",
              executed_capability: "situation-room.describe_visual_capture",
              observation_kind: "situation_context_pack",
              observation_ref: "obs:visual-context",
              satisfaction: "satisfied",
              rail_status: "complete",
              terminal_contribution_kind: "situation_context_pack",
            },
            {
              requested_capability: "scientific-calculator.solve_expression",
              selected_capability: "scientific-calculator.solve_expression",
              executed_capability: "scientific-calculator.solve_expression",
              observation_kind: "calculator_receipt",
              observation_ref: "obs:calculator",
              satisfaction: "satisfied",
              rail_status: "complete",
              terminal_contribution_kind: "workstation_tool_evaluation",
            },
          ],
        },
      },
      artifacts: [],
    });

    expect(readiness).toMatchObject({
      applies: true,
      complete: true,
      synthesis_required: true,
      has_docs_subgoal: false,
      goal_kind: "compound_evidence_synthesis",
      required_terminal_kind: "compound_evidence_synthesis_answer",
      synthesis_terminal_kind: "compound_evidence_synthesis_answer",
    });
    expect(readiness.support_refs).toEqual(["obs:visual-context", "obs:calculator"]);
    expect(readiness.terminal_contribution_kinds).toEqual([
      "situation_context_pack",
      "workstation_tool_evaluation",
    ]);
  });

  it("requires synthesis after catalog and workspace subgoals are both observed", () => {
    const readiness = resolveCompoundCapabilitySynthesisReadiness({
      payload: {
        capability_itinerary_execution_state: {
          schema: "helix.capability_itinerary_execution_state.v1",
          applies: true,
          complete: true,
          required_observation_families: ["capability_catalog", "workspace_diagnostic"],
          required_capabilities: ["helix_ask.inspect_capability_catalog", "workspace_os.status"],
          compound_subgoal_ledger: [
            {
              requested_capability: "helix_ask.inspect_capability_catalog",
              executed_capability: "helix_ask.inspect_capability_catalog",
              observation_kind: "capability_registry",
              observation_ref: "obs:capability-registry",
              satisfaction: "satisfied",
              rail_status: "complete",
              terminal_contribution_kind: "capability_help_summary",
            },
            {
              requested_capability: "workspace_os.status",
              executed_capability: "workspace_os.status",
              observation_kind: "workspace_os_status_observation",
              observation_ref: "obs:workspace-status",
              satisfaction: "satisfied",
              rail_status: "complete",
              terminal_contribution_kind: "model_synthesized_answer",
            },
          ],
        },
      },
      artifacts: [],
    });

    expect(readiness).toMatchObject({
      applies: true,
      complete: true,
      synthesis_required: true,
      has_docs_subgoal: false,
      goal_kind: "compound_evidence_synthesis",
      required_terminal_kind: "compound_evidence_synthesis_answer",
      synthesis_terminal_kind: "compound_evidence_synthesis_answer",
    });
    expect(readiness.support_refs).toEqual(["obs:capability-registry", "obs:workspace-status"]);
    expect(readiness.terminal_contribution_kinds).toEqual([
      "capability_help_summary",
      "model_synthesized_answer",
    ]);
  });

  it("still requires synthesis when a compound final draft exists without a materialized terminal artifact", () => {
    const turnId = "ask:test:catalog-workspace-draft-no-terminal";
    const readiness = resolveCompoundCapabilitySynthesisReadiness({
      payload: {
        capability_itinerary_execution_state: {
          schema: "helix.capability_itinerary_execution_state.v1",
          applies: true,
          complete: true,
          required_observation_families: ["capability_catalog", "workspace_diagnostic"],
          required_capabilities: ["helix_ask.inspect_capability_catalog", "workspace_os.status"],
          compound_subgoal_ledger: [
            {
              requested_capability: "helix_ask.inspect_capability_catalog",
              executed_capability: "helix_ask.inspect_capability_catalog",
              observation_kind: "capability_registry",
              observation_ref: "obs:capability-registry",
              satisfaction: "satisfied",
              rail_status: "complete",
              terminal_contribution_kind: "capability_help_summary",
            },
            {
              requested_capability: "workspace_os.status",
              executed_capability: "workspace_os.status",
              observation_kind: "workspace_os_status_observation",
              observation_ref: "obs:workspace-status",
              satisfaction: "satisfied",
              rail_status: "complete",
              terminal_contribution_kind: "model_synthesized_answer",
            },
          ],
        },
        final_answer_draft: {
          artifact_id: `${turnId}:final_answer_draft`,
          text: "The catalog and workspace status observations are ready for synthesis.",
          required_terminal_kind: "compound_evidence_synthesis_answer",
          support_refs: ["obs:capability-registry", "obs:workspace-status"],
        },
      },
      artifacts: [
        {
          artifact_id: `${turnId}:final_answer_draft`,
          kind: "final_answer_draft",
          payload: {
            text: "The catalog and workspace status observations are ready for synthesis.",
            required_terminal_kind: "compound_evidence_synthesis_answer",
            support_refs: ["obs:capability-registry", "obs:workspace-status"],
          },
        },
      ],
    });

    expect(readiness).toMatchObject({
      applies: true,
      complete: true,
      has_final_answer_draft: true,
      has_materialized_terminal_artifact: false,
      synthesis_required: true,
      goal_kind: "compound_evidence_synthesis",
      required_terminal_kind: "compound_evidence_synthesis_answer",
    });
  });

  it("prefers rebuilt complete state over a stale incomplete payload mirror", () => {
    const turnId = "ask:test:stale-catalog-workspace-state";
    const itinerary = {
      schema: "helix.capability_itinerary.v1",
      terminal_success_criteria: {
        requires_post_observation_synthesis: true,
        required_observation_families: ["capability_catalog", "workspace_diagnostic"],
        required_capabilities: ["helix_ask.inspect_capability_catalog", "workspace_os.status"],
      },
      compound_capability_contract: {
        schema: "helix.compound_capability_contract.v1",
        subgoals: [
          {
            subgoal_id: `${turnId}:compound_capability_subgoal:1:helix_ask_inspect_capability_catalog`,
            requested_capability: "helix_ask.inspect_capability_catalog",
            runtime_capability: "helix_ask.inspect_capability_catalog",
            required_observation_kinds: ["capability_registry"],
            terminal_contribution_kind: "capability_help_summary",
          },
          {
            subgoal_id: `${turnId}:compound_capability_subgoal:2:workspace_os_status`,
            requested_capability: "workspace_os.status",
            runtime_capability: "workspace_os.status",
            required_observation_kinds: ["workspace_os_status_observation"],
            terminal_contribution_kind: "model_synthesized_answer",
          },
        ],
      },
    };
    const readiness = resolveCompoundCapabilitySynthesisReadiness({
      payload: {
        capability_itinerary: itinerary,
        capability_itinerary_execution_state: {
          schema: "helix.capability_itinerary_execution_state.v1",
          applies: true,
          complete: false,
          required_observation_families: ["capability_catalog", "workspace_diagnostic"],
          missing_observation_families: ["workspace_diagnostic"],
          compound_subgoal_ledger: [
            {
              requested_capability: "helix_ask.inspect_capability_catalog",
              executed_capability: "helix_ask.inspect_capability_catalog",
              observation_kind: "capability_registry",
              observation_ref: "obs:capability-registry",
              satisfaction: "satisfied",
              rail_status: "complete",
            },
            {
              requested_capability: "workspace_os.status",
              executed_capability: null,
              observation_kind: null,
              observation_ref: null,
              satisfaction: "pending",
              rail_status: "pending",
            },
          ],
        },
      },
      capabilityItinerary: itinerary,
      artifacts: [
        {
          artifact_id: "obs:capability-registry",
          kind: "capability_registry",
          payload: {
            kind: "capability_registry",
            capability_key: "helix_ask.inspect_capability_catalog",
          },
        },
        {
          artifact_id: "obs:catalog-runtime",
          kind: "runtime_tool_observation",
          payload: {
            capability_key: "helix_ask.inspect_capability_catalog",
            status: "completed",
            artifact_refs: ["obs:capability-registry"],
          },
        },
        {
          artifact_id: "obs:workspace-status",
          kind: "workspace_os_status_observation",
          payload: {
            schema: "helix.workspace_os_status_observation.v1",
            capability_key: "workspace_os.status",
          },
        },
        {
          artifact_id: "obs:workspace-runtime",
          kind: "runtime_tool_observation",
          payload: {
            capability_key: "workspace_os.status",
            status: "completed",
            artifact_refs: ["obs:workspace-status"],
          },
        },
      ],
    });

    expect(readiness).toMatchObject({
      applies: true,
      complete: true,
      synthesis_required: true,
      goal_kind: "compound_evidence_synthesis",
      required_terminal_kind: "compound_evidence_synthesis_answer",
    });
    expect(readiness.support_refs).toEqual(["obs:capability-registry", "obs:workspace-status"]);
  });

  it("uses the runtime itinerary argument when the payload mirror is absent", () => {
    const turnId = "ask:test:runtime-itinerary-argument";
    const readiness = resolveCompoundCapabilitySynthesisReadiness({
      payload: {},
      capabilityItinerary: {
        schema: "helix.capability_itinerary.v1",
        terminal_success_criteria: {
          requires_post_observation_synthesis: true,
          required_observation_families: ["docs_viewer", "calculator"],
        },
        planned_steps: [
          { requested_capability: "docs-viewer.locate_in_doc" },
          { requested_capability: "scientific-calculator.solve_expression" },
        ],
        execution_state: {
          complete: true,
          required_observation_families: ["docs_viewer", "calculator"],
          compound_subgoal_ledger: [
            {
              requested_capability: "docs-viewer.locate_in_doc",
              observation_ref: `${turnId}:doc_location`,
              satisfaction: "satisfied",
              rail_status: "complete",
            },
            {
              requested_capability: "scientific-calculator.solve_expression",
              observation_ref: `${turnId}:calculator_receipt`,
              satisfaction: "satisfied",
              rail_status: "complete",
            },
          ],
        },
      },
      artifacts: [],
    });

    expect(readiness).toMatchObject({
      applies: true,
      complete: true,
      synthesis_required: true,
      goal_kind: "doc_evidence_synthesis",
      required_terminal_kind: "doc_evidence_synthesis_answer",
    });
  });

  it("treats docs equation context plus calculator as docs evidence synthesis", () => {
    const turnId = "ask:test:docs-equation-context-compound-synthesis";
    const readiness = resolveCompoundCapabilitySynthesisReadiness({
      payload: {},
      capabilityItinerary: {
        schema: "helix.capability_itinerary.v1",
        terminal_success_criteria: {
          requires_post_observation_synthesis: true,
          required_observation_families: ["docs_viewer", "calculator"],
        },
        planned_steps: [
          { requested_capability: "docs-viewer.doc_equation_context" },
          { requested_capability: "scientific-calculator.solve_expression" },
        ],
        execution_state: {
          complete: true,
          required_observation_families: ["docs_viewer", "calculator"],
          compound_subgoal_ledger: [
            {
              requested_capability: "docs-viewer.doc_equation_context",
              observation_kind: "doc_equation_context",
              observation_ref: `${turnId}:doc_equation_context`,
              satisfaction: "satisfied",
              rail_status: "complete",
            },
            {
              requested_capability: "scientific-calculator.solve_expression",
              observation_kind: "calculator_receipt",
              observation_ref: `${turnId}:calculator_receipt`,
              satisfaction: "satisfied",
              rail_status: "complete",
            },
          ],
        },
      },
      artifacts: [],
    });

    expect(readiness).toMatchObject({
      applies: true,
      complete: true,
      synthesis_required: true,
      has_docs_subgoal: true,
      goal_kind: "doc_evidence_synthesis",
      required_terminal_kind: "doc_evidence_synthesis_answer",
      synthesis_terminal_kind: "doc_evidence_synthesis_answer",
    });
  });

  it("requires docs compound synthesis even when an earlier subgoal draft exists", () => {
    const turnId = "ask:test:docs-compound-stale-draft";
    const readiness = resolveCompoundCapabilitySynthesisReadiness({
      payload: {
        capability_itinerary: {
          schema: "helix.capability_itinerary.v1",
          terminal_success_criteria: {
            requires_post_observation_synthesis: true,
            required_observation_families: ["docs_viewer", "calculator"],
          },
          planned_steps: [
            { requested_capability: "docs-viewer.locate_in_doc" },
            { requested_capability: "scientific-calculator.solve_expression" },
          ],
          execution_state: {
            complete: true,
            required_observation_families: ["docs_viewer", "calculator"],
            compound_subgoal_ledger: [
              {
                requested_capability: "docs-viewer.locate_in_doc",
                observation_ref: "obs:doc-location",
                satisfaction: "satisfied",
                rail_status: "complete",
              },
              {
                requested_capability: "scientific-calculator.solve_expression",
                observation_ref: "obs:calculator",
                satisfaction: "satisfied",
                rail_status: "complete",
              },
            ],
          },
        },
        final_answer_draft: {
          text: "The doc location subgoal was drafted before calculator synthesis.",
          required_terminal_kind: "doc_location_matches",
        },
      },
      artifacts: [],
    });

    expect(readiness).toMatchObject({
      applies: true,
      complete: true,
      has_final_answer_draft: true,
      synthesis_required: true,
      has_docs_subgoal: true,
      goal_kind: "doc_evidence_synthesis",
      required_terminal_kind: "doc_evidence_synthesis_answer",
    });
  });

  it("does not let a stale generic terminal suppress required docs compound synthesis", () => {
    const readiness = resolveCompoundCapabilitySynthesisReadiness({
      payload: {
        capability_itinerary_execution_state: {
          schema: "helix.capability_itinerary_execution_state.v1",
          applies: true,
          complete: true,
          compound_subgoal_ledger: [
            {
              requested_capability: "docs-viewer.locate_in_doc",
              executed_capability: "docs-viewer.locate_in_doc",
              observation_kind: "doc_location_matches",
              observation_ref: "obs:doc-location",
              satisfaction: "satisfied",
              rail_status: "complete",
            },
            {
              requested_capability: "scientific-calculator.solve_expression",
              executed_capability: "scientific-calculator.solve_expression",
              observation_kind: "calculator_receipt",
              observation_ref: "obs:calculator",
              satisfaction: "satisfied",
              rail_status: "complete",
            },
          ],
        },
        model_synthesized_answer: {
          text: "This generic terminal came from a stale non-doc projection.",
          support_refs: ["obs:doc-location", "obs:calculator"],
        },
      },
      artifacts: [],
    });

    expect(readiness).toMatchObject({
      applies: true,
      complete: true,
      has_docs_subgoal: true,
      has_materialized_terminal_artifact: false,
      synthesis_required: true,
      required_terminal_kind: "doc_evidence_synthesis_answer",
    });
  });

  it("uses capability_registry as the catalog observation inside compound contracts", () => {
    const contract = buildHelixCompoundCapabilityContract({
      turnId: "ask:test:catalog-workspace",
      promptText: "Call helix_ask.inspect_capability_catalog, then use workspace_os.status to inspect workstation status.",
    });

    expect(contract?.subgoals.map((subgoal) => subgoal.requested_capability)).toEqual([
      "helix_ask.inspect_capability_catalog",
      "workspace_os.status",
    ]);
    expect(contract?.subgoals[0]?.required_observation_kinds).toEqual(["capability_registry"]);
    expect(contract?.subgoals[0]?.required_terminal_kind).toBe("capability_help_summary");
    expect(contract?.subgoals[0]?.contribution_role).toBe("capability_catalog");
    expect(contract?.subgoals[0]?.terminal_contribution_kind).toBe("capability_help_summary");
  });

  it("does not create an Image Lens subgoal from an explanatory research workflow question", () => {
    const contract = buildHelixCompoundCapabilityContract({
      turnId: "ask:test:research-paper-capability-question",
      promptText:
        "Does your research-paper tool let you choose papers it can parse, or do you first check which papers are openable and then use Image Lens? Answer only from your capability contract. Do not retrieve a paper or call a tool.",
    });

    expect(contract?.required_capabilities).toEqual(["helix_ask.inspect_capability_catalog"]);
    expect(contract?.requires_all_subgoals).toBe(false);
    expect(contract?.subgoals.some((subgoal) => subgoal.requested_capability === "image_lens.inspect")).toBe(false);
  });

  it("makes explicit catalog prompts dominate repo fallback contracts", () => {
    const arbitration = resolveAskCapabilityContractArbitration({
      turnId: "ask:test:catalog-dominance",
      promptText: "Call helix_ask.inspect_capability_catalog to list the tools available to Helix Ask.",
      fallbackSourceTarget: "repo_code",
      fallbackPlanFamily: "repo_code",
      fallbackGoalKind: "repo_code_evidence_question",
      fallbackRequiredTerminalKind: "repo_code_evidence_answer",
    });

    expect(arbitration).toMatchObject({
      contract_state: "explicit_capability_command",
      requested_capability: "helix_ask.inspect_capability_catalog",
      selected_source_target: "runtime_evidence",
      selected_plan_family: "capability_catalog",
      canonical_goal_kind: "capability_help",
      required_terminal_kind: "capability_help_summary",
      route_metadata_demoted: false,
    });
  });

  it("does not classify completed catalog compounds as repo evidence", () => {
    expect(inferFinalAnswerDraftRouteFamily({
      routeProductContract: {
        source_target: "runtime_evidence",
        allowed_terminal_artifact_kinds: ["capability_help_summary"],
      },
      payload: {
        canonical_goal_frame: {
          goal_kind: "capability_help",
          required_terminal_kind: "capability_help_summary",
        },
        compound_capability_synthesis_readiness: {
          applies: true,
          complete: true,
          required_terminal_kind: "model_synthesized_answer",
          synthesis_terminal_kind: "model_synthesized_answer",
        },
        compound_capability_contract: {
          subgoals: [
            { requested_capability: "helix_ask.inspect_capability_catalog" },
            { requested_capability: "workspace_os.status" },
          ],
        },
      },
      artifactLedger: [],
    })).toBe("unknown");

    expect(inferFinalAnswerDraftRouteFamily({
      routeProductContract: {
        source_target: "runtime_evidence",
        allowed_terminal_artifact_kinds: ["capability_help_summary"],
      },
      payload: {
        canonical_goal_frame: {
          goal_kind: "capability_help",
          required_terminal_kind: "capability_help_summary",
        },
      },
      artifactLedger: [],
    })).toBe("capability_catalog");
  });

  it("materializes catalog plus workspace compound synthesis from satisfied observations", () => {
    const turnId = "ask:test:catalog-workspace-materializer";
    const finalAnswerDraft = {
      artifact_id: `${turnId}:final_answer_draft`,
      kind: "final_answer_draft",
      payload: {
        schema: "helix.final_answer_draft.v1",
        text: "The capability catalog reported the active tool surface, and workspace status reported the current workstation capability counts.",
        answer_text: "The capability catalog reported the active tool surface, and workspace status reported the current workstation capability counts.",
        goal_kind: "compound_evidence_synthesis",
        required_terminal_kind: "compound_evidence_synthesis_answer",
        support_refs: ["obs:capability-registry", "obs:workspace-status"],
        artifact_refs: ["obs:capability-registry", "obs:workspace-status"],
        authority: "llm_post_observation_compound_synthesis",
      },
    };
    const payload = {
      canonical_goal_frame: {
        goal_kind: "capability_help",
        required_terminal_kind: "capability_help_summary",
      },
      route_product_contract: {
        source_target: "runtime_evidence",
        allowed_terminal_artifact_kinds: ["capability_help_summary"],
      },
      compound_capability_contract: {
        subgoals: [
          { requested_capability: "helix_ask.inspect_capability_catalog" },
          { requested_capability: "workspace_os.status" },
        ],
      },
      compound_capability_synthesis_readiness: {
        applies: true,
        complete: true,
        required_terminal_kind: "compound_evidence_synthesis_answer",
        synthesis_terminal_kind: "compound_evidence_synthesis_answer",
      },
      capability_itinerary_execution_state: {
        applies: true,
        complete: true,
        compound_subgoal_ledger: [
          {
            requested_capability: "helix_ask.inspect_capability_catalog",
            executed_capability: "helix_ask.inspect_capability_catalog",
            observation_kind: "capability_registry",
            observation_ref: "obs:capability-registry",
            satisfaction: "satisfied",
            rail_status: "complete",
          },
          {
            requested_capability: "workspace_os.status",
            executed_capability: "workspace_os.status",
            observation_kind: "workspace_os_status_observation",
            observation_ref: "obs:workspace-status",
            satisfaction: "satisfied",
            rail_status: "complete",
          },
        ],
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "obs:capability-registry",
          kind: "capability_registry",
          payload: { schema: "helix.capability_catalog_observation.v1" },
        },
        {
          artifact_id: "obs:workspace-status",
          kind: "workspace_os_status_observation",
          payload: { schema: "helix.workspace_os_status_observation.v1" },
        },
        finalAnswerDraft,
      ],
    };

    const result = materializeFinalAnswerDraftTerminal({
      turnId,
      payload,
      artifactLedger: payload.current_turn_artifact_ledger,
      routeProductContract: {
        source_target: "runtime_evidence",
        allowed_terminal_artifact_kinds: ["capability_help_summary"],
      },
      finalAnswerDraftRef: `${turnId}:final_answer_draft`,
    });

    expect(result).toMatchObject({
      ok: true,
      materialized_terminal_artifact_kind: "compound_evidence_synthesis_answer",
    });
    expect(payload.compound_evidence_synthesis_answer).toMatchObject({
      support_refs: ["obs:capability-registry", "obs:workspace-status"],
      subgoal_observation_refs: ["obs:capability-registry", "obs:workspace-status"],
      model_step_capability: "model.synthesize_from_compound_subgoal_observations",
    });
  });

  it("blocks compound final draft materialization when a mandatory subgoal is incomplete", () => {
    const turnId = "ask:test:compound-incomplete-materializer";
    const finalAnswerDraft = {
      artifact_id: `${turnId}:final_answer_draft`,
      kind: "final_answer_draft",
      payload: {
        schema: "helix.final_answer_draft.v1",
        text: "The capability catalog and workspace status observations are ready for synthesis.",
        answer_text: "The capability catalog and workspace status observations are ready for synthesis.",
        goal_kind: "compound_evidence_synthesis",
        required_terminal_kind: "compound_evidence_synthesis_answer",
        support_refs: ["obs:capability-registry"],
        artifact_refs: ["obs:capability-registry"],
        authority: "llm_post_observation_compound_synthesis",
      },
    };
    const payload = {
      route_product_contract: {
        source_target: "runtime_evidence",
        allowed_terminal_artifact_kinds: ["compound_evidence_synthesis_answer"],
      },
      compound_capability_synthesis_readiness: {
        applies: true,
        complete: false,
        has_failed_subgoal: true,
        support_refs: ["obs:capability-registry"],
        required_terminal_kind: "compound_evidence_synthesis_answer",
        synthesis_terminal_kind: "compound_evidence_synthesis_answer",
      },
      capability_itinerary_execution_state: {
        applies: true,
        complete: false,
        compound_subgoal_ledger: [
          {
            requested_capability: "helix_ask.inspect_capability_catalog",
            executed_capability: "helix_ask.inspect_capability_catalog",
            observation_kind: "capability_registry",
            observation_ref: "obs:capability-registry",
            satisfaction: "satisfied",
            rail_status: "complete",
          },
          {
            requested_capability: "workspace_os.status",
            selected_capability: "workspace_os.status",
            executed_capability: null,
            observation_kind: null,
            observation_ref: null,
            satisfaction: "missing",
            rail_status: "fail_closed",
            first_broken_rail: "observation_artifact",
            rail_failure_code: "required_observation_missing",
            repair_target: "observation_materializer",
          },
        ],
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "obs:capability-registry",
          kind: "capability_registry",
          payload: { schema: "helix.capability_catalog_observation.v1" },
        },
        finalAnswerDraft,
      ],
    };

    const result = materializeFinalAnswerDraftTerminal({
      turnId,
      payload,
      artifactLedger: payload.current_turn_artifact_ledger,
      routeProductContract: payload.route_product_contract,
      finalAnswerDraftRef: `${turnId}:final_answer_draft`,
    });

    expect(result).toMatchObject({
      ok: false,
      blocked_reason: "compound_subgoal_incomplete",
    });
    expect(payload.model_synthesized_answer).toBeUndefined();
    expect(payload.compound_evidence_synthesis_answer).toBeUndefined();
  });

  it("blocks compound final draft materialization when a satisfied subgoal lacks an observation ref", () => {
    const turnId = "ask:test:compound-satisfied-no-observation-ref-materializer";
    const finalAnswerDraft = {
      artifact_id: `${turnId}:final_answer_draft`,
      kind: "final_answer_draft",
      payload: {
        schema: "helix.final_answer_draft.v1",
        text: "The capability catalog and workspace status observations are ready for synthesis.",
        answer_text: "The capability catalog and workspace status observations are ready for synthesis.",
        goal_kind: "compound_evidence_synthesis",
        required_terminal_kind: "compound_evidence_synthesis_answer",
        support_refs: ["obs:capability-registry"],
        artifact_refs: ["obs:capability-registry"],
        authority: "llm_post_observation_compound_synthesis",
      },
    };
    const payload = {
      route_product_contract: {
        source_target: "runtime_evidence",
        allowed_terminal_artifact_kinds: ["compound_evidence_synthesis_answer"],
      },
      compound_capability_synthesis_readiness: {
        applies: true,
        complete: true,
        support_refs: ["obs:capability-registry"],
        required_terminal_kind: "compound_evidence_synthesis_answer",
        synthesis_terminal_kind: "compound_evidence_synthesis_answer",
      },
      capability_itinerary_execution_state: {
        applies: true,
        complete: true,
        compound_subgoal_ledger: [
          {
            requested_capability: "helix_ask.inspect_capability_catalog",
            executed_capability: "helix_ask.inspect_capability_catalog",
            observation_kind: "capability_registry",
            observation_ref: "obs:capability-registry",
            satisfaction: "satisfied",
            rail_status: "complete",
          },
          {
            requested_capability: "workspace_os.status",
            executed_capability: "workspace_os.status",
            observation_kind: "workspace_os_status_observation",
            observation_ref: null,
            satisfaction: "satisfied",
            rail_status: "complete",
          },
        ],
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "obs:capability-registry",
          kind: "capability_registry",
          payload: { schema: "helix.capability_catalog_observation.v1" },
        },
        finalAnswerDraft,
      ],
    };

    const result = materializeFinalAnswerDraftTerminal({
      turnId,
      payload,
      artifactLedger: payload.current_turn_artifact_ledger,
      routeProductContract: payload.route_product_contract,
      finalAnswerDraftRef: `${turnId}:final_answer_draft`,
    });

    expect(result).toMatchObject({
      ok: false,
      blocked_reason: "compound_subgoal_incomplete",
    });
    expect(payload.model_synthesized_answer).toBeUndefined();
    expect(payload.compound_evidence_synthesis_answer).toBeUndefined();
  });

  it("blocks compound final draft materialization when the execution ledger drops a required later subgoal", () => {
    const turnId = "ask:test:compound-dropped-later-subgoal-materializer";
    const catalogSubgoalId = `${turnId}:compound_capability_subgoal:1:helix_ask_inspect_capability_catalog`;
    const workspaceSubgoalId = `${turnId}:compound_capability_subgoal:2:workspace_os_status`;
    const finalAnswerDraft = {
      artifact_id: `${turnId}:final_answer_draft`,
      kind: "final_answer_draft",
      payload: {
        schema: "helix.final_answer_draft.v1",
        text: "The capability catalog observation is ready for synthesis.",
        answer_text: "The capability catalog observation is ready for synthesis.",
        goal_kind: "compound_evidence_synthesis",
        required_terminal_kind: "compound_evidence_synthesis_answer",
        support_refs: ["obs:capability-registry"],
        artifact_refs: ["obs:capability-registry"],
        authority: "llm_post_observation_compound_synthesis",
      },
    };
    const payload = {
      route_product_contract: {
        source_target: "runtime_evidence",
        allowed_terminal_artifact_kinds: ["compound_evidence_synthesis_answer"],
      },
      compound_capability_contract: {
        schema: "helix.compound_capability_contract.v1",
        requires_all_subgoals: true,
        subgoals: [
          {
            subgoal_id: catalogSubgoalId,
            requested_capability: "helix_ask.inspect_capability_catalog",
            required_observation_kinds: ["capability_registry"],
            required_terminal_kind: "capability_help_summary",
          },
          {
            subgoal_id: workspaceSubgoalId,
            requested_capability: "workspace_os.status",
            required_observation_kinds: ["workspace_os_status_observation"],
            required_terminal_kind: "compound_evidence_synthesis_answer",
          },
        ],
      },
      compound_capability_synthesis_readiness: {
        applies: true,
        complete: true,
        support_refs: ["obs:capability-registry"],
        required_terminal_kind: "compound_evidence_synthesis_answer",
        synthesis_terminal_kind: "compound_evidence_synthesis_answer",
      },
      capability_itinerary_execution_state: {
        applies: true,
        complete: true,
        compound_subgoal_ledger: [
          {
            subgoal_id: catalogSubgoalId,
            requested_capability: "helix_ask.inspect_capability_catalog",
            executed_capability: "helix_ask.inspect_capability_catalog",
            observation_kind: "capability_registry",
            observation_ref: "obs:capability-registry",
            satisfaction: "satisfied",
            rail_status: "complete",
          },
        ],
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "obs:capability-registry",
          kind: "capability_registry",
          payload: { schema: "helix.capability_catalog_observation.v1" },
        },
        finalAnswerDraft,
      ],
    };

    const result = materializeFinalAnswerDraftTerminal({
      turnId,
      payload,
      artifactLedger: payload.current_turn_artifact_ledger,
      routeProductContract: payload.route_product_contract,
      finalAnswerDraftRef: `${turnId}:final_answer_draft`,
    });

    expect(result).toMatchObject({
      ok: false,
      blocked_reason: "compound_subgoal_incomplete",
    });
    expect(payload.model_synthesized_answer).toBeUndefined();
    expect(payload.compound_evidence_synthesis_answer).toBeUndefined();
  });

  it("promotes satisfied compound subgoal observations into compound terminal support refs", () => {
    const turnId = "ask:test:compound-terminal-support-coverage";
    const finalAnswerDraft = {
      artifact_id: `${turnId}:final_answer_draft`,
      kind: "final_answer_draft",
      payload: {
        schema: "helix.final_answer_draft.v1",
        text: "The capability catalog and workspace status observations are ready for synthesis.",
        answer_text: "The capability catalog and workspace status observations are ready for synthesis.",
        goal_kind: "compound_evidence_synthesis",
        required_terminal_kind: "compound_evidence_synthesis_answer",
        support_refs: ["obs:capability-registry"],
        artifact_refs: ["obs:capability-registry"],
        authority: "llm_post_observation_compound_synthesis",
      },
    };
    const payload = {
      route_product_contract: {
        source_target: "runtime_evidence",
        allowed_terminal_artifact_kinds: ["compound_evidence_synthesis_answer"],
      },
      compound_capability_synthesis_readiness: {
        applies: true,
        complete: true,
        support_refs: ["obs:capability-registry", "obs:workspace-status"],
        required_terminal_kind: "compound_evidence_synthesis_answer",
        synthesis_terminal_kind: "compound_evidence_synthesis_answer",
      },
      capability_itinerary_execution_state: {
        applies: true,
        complete: true,
        compound_subgoal_ledger: [
          {
            requested_capability: "helix_ask.inspect_capability_catalog",
            executed_capability: "helix_ask.inspect_capability_catalog",
            observation_kind: "capability_registry",
            observation_ref: "obs:capability-registry",
            satisfaction: "satisfied",
            rail_status: "complete",
          },
          {
            requested_capability: "workspace_os.status",
            executed_capability: "workspace_os.status",
            observation_kind: "workspace_os_status_observation",
            observation_ref: "obs:workspace-status",
            satisfaction: "satisfied",
            rail_status: "complete",
          },
        ],
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "obs:capability-registry",
          kind: "capability_registry",
          payload: { schema: "helix.capability_catalog_observation.v1" },
        },
        {
          artifact_id: "obs:workspace-status",
          kind: "workspace_os_status_observation",
          payload: { schema: "helix.workspace_os_status_observation.v1" },
        },
        finalAnswerDraft,
      ],
    };

    const result = materializeFinalAnswerDraftTerminal({
      turnId,
      payload,
      artifactLedger: payload.current_turn_artifact_ledger,
      routeProductContract: payload.route_product_contract,
      finalAnswerDraftRef: `${turnId}:final_answer_draft`,
    });

    expect(result).toMatchObject({
      ok: true,
      materialized_terminal_artifact_kind: "compound_evidence_synthesis_answer",
    });
    expect(payload.compound_evidence_synthesis_answer).toMatchObject({
      support_refs: ["obs:capability-registry", "obs:workspace-status"],
      support_refs_count: 2,
      subgoal_observation_refs: ["obs:capability-registry", "obs:workspace-status"],
      subgoal_observation_refs_count: 2,
      source_families: ["capability_catalog", "workspace_diagnostic"],
    });
  });

  it("treats a multi-subgoal execution ledger as compound terminal policy without readiness mirrors", () => {
    const turnId = "ask:test:ledger-only-compound-terminal-support";
    const finalAnswerDraft = {
      artifact_id: `${turnId}:final_answer_draft`,
      kind: "final_answer_draft",
      payload: {
        schema: "helix.final_answer_draft.v1",
        text: "The visual capture and calculator observations are ready for synthesis.",
        answer_text: "The visual capture and calculator observations are ready for synthesis.",
        goal_kind: "compound_evidence_synthesis",
        required_terminal_kind: "compound_evidence_synthesis_answer",
        support_refs: ["obs:visual-context"],
        artifact_refs: ["obs:visual-context"],
        authority: "llm_post_observation_compound_synthesis",
      },
    };
    const payload = {
      route_product_contract: {
        source_target: "runtime_evidence",
        allowed_terminal_artifact_kinds: ["compound_evidence_synthesis_answer"],
      },
      capability_itinerary_execution_state: {
        applies: true,
        complete: true,
        compound_subgoal_ledger: [
          {
            requested_capability: "situation-room.describe_visual_capture",
            executed_capability: "situation-room.describe_visual_capture",
            observation_kind: "situation_context_pack",
            observation_ref: "obs:visual-context",
            satisfaction: "satisfied",
            rail_status: "complete",
          },
          {
            requested_capability: "scientific-calculator.solve_expression",
            executed_capability: "scientific-calculator.solve_expression",
            observation_kind: "calculator_receipt",
            observation_ref: "obs:calculator",
            satisfaction: "satisfied",
            rail_status: "complete",
          },
        ],
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "obs:visual-context",
          kind: "situation_context_pack",
          payload: { schema: "helix.situation_context_pack.v1" },
        },
        {
          artifact_id: "obs:calculator",
          kind: "calculator_receipt",
          payload: { schema: "helix.calculator_receipt.v1" },
        },
        finalAnswerDraft,
      ],
    };

    const result = materializeFinalAnswerDraftTerminal({
      turnId,
      payload,
      artifactLedger: payload.current_turn_artifact_ledger,
      routeProductContract: payload.route_product_contract,
      finalAnswerDraftRef: `${turnId}:final_answer_draft`,
    });

    expect(result).toMatchObject({
      ok: true,
      materialized_terminal_artifact_kind: "compound_evidence_synthesis_answer",
    });
    expect(payload.compound_evidence_synthesis_answer).toMatchObject({
      support_refs: ["obs:visual-context", "obs:calculator"],
      subgoal_observation_refs: ["obs:visual-context", "obs:calculator"],
      source_families: ["visual_capture", "calculator"],
      model_step_capability: "model.synthesize_from_compound_subgoal_observations",
    });
  });

  it("preserves semantic live-source-mail source families from execution-ledger fallback", () => {
    const turnId = "ask:test:live-source-mail-materializer";
    const finalAnswerDraft = {
      artifact_id: `${turnId}:final_answer_draft`,
      kind: "final_answer_draft",
      payload: {
        schema: "helix.final_answer_draft.v1",
        text: "The live-source mailbox read, process, and reflection observations are ready for operator review.",
        answer_text: "The live-source mailbox read, process, and reflection observations are ready for operator review.",
        goal_kind: "compound_evidence_synthesis",
        required_terminal_kind: "compound_evidence_synthesis_answer",
        support_refs: ["obs:mail-read", "obs:mail-process", "obs:mail-reflect"],
        artifact_refs: ["obs:mail-read", "obs:mail-process", "obs:mail-reflect"],
        authority: "llm_post_observation_compound_synthesis",
      },
    };
    const payload = {
      canonical_goal_frame: {
        goal_kind: "compound_evidence_synthesis",
        required_terminal_kind: "compound_evidence_synthesis_answer",
      },
      route_product_contract: {
        source_target: "live_source_mailbox",
        allowed_terminal_artifact_kinds: ["compound_evidence_synthesis_answer"],
      },
      capability_itinerary_execution_state: {
        applies: true,
        complete: true,
        compound_subgoal_ledger: [
          {
            requested_capability: "live_env.read_processed_live_source_mail",
            executed_capability: "live_env.read_processed_live_source_mail",
            observation_kind: "stage_play_processed_mail_packet",
            observation_ref: "obs:mail-read",
            satisfaction: "satisfied",
            rail_status: "complete",
          },
          {
            requested_capability: "live_env.process_live_source_mail",
            executed_capability: "live_env.process_live_source_mail",
            observation_kind: "stage_play_live_source_mail_read_result",
            observation_ref: "obs:mail-process",
            satisfaction: "satisfied",
            rail_status: "complete",
          },
          {
            requested_capability: "live_env.reflect_live_source_mail_loop",
            executed_capability: "live_env.reflect_live_source_mail_loop",
            observation_kind: "stage_play_live_source_mail_loop_reflection",
            observation_ref: "obs:mail-reflect",
            satisfaction: "satisfied",
            rail_status: "complete",
          },
        ],
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "obs:mail-read",
          kind: "stage_play_processed_mail_packet",
          payload: { schema: "stage_play_processed_mail_packet/v1" },
        },
        {
          artifact_id: "obs:mail-process",
          kind: "stage_play_live_source_mail_read_result",
          payload: { schema: "stage_play_processed_live_source_mail_read_result/v1" },
        },
        {
          artifact_id: "obs:mail-reflect",
          kind: "stage_play_live_source_mail_loop_reflection",
          payload: { schema: "stage_play_live_source_mail_loop_reflection/v1" },
        },
        finalAnswerDraft,
      ],
    };

    const result = materializeFinalAnswerDraftTerminal({
      turnId,
      payload,
      artifactLedger: payload.current_turn_artifact_ledger,
      routeProductContract: {
        source_target: "live_source_mailbox",
        allowed_terminal_artifact_kinds: ["compound_evidence_synthesis_answer"],
      },
      finalAnswerDraftRef: `${turnId}:final_answer_draft`,
    });

    expect(result).toMatchObject({
      ok: true,
      materialized_terminal_artifact_kind: "compound_evidence_synthesis_answer",
    });
    expect(payload.compound_evidence_synthesis_answer).toMatchObject({
      source_families: ["live_source_mail"],
      support_refs: ["obs:mail-read", "obs:mail-process", "obs:mail-reflect"],
      subgoal_observation_refs: ["obs:mail-read", "obs:mail-process", "obs:mail-reflect"],
      model_step_capability: "model.synthesize_from_compound_subgoal_observations",
    });
  });

  it("materializes compound research locator answers with ordered subgoal support refs", () => {
    const turnId = "ask:test:compound-research-locator-materializer";
    const finalAnswerDraft = {
      artifact_id: `${turnId}:final_answer_draft`,
      kind: "final_answer_draft",
      payload: {
        schema: "helix.final_answer_draft.v1",
        text: "The cited research observation and reflected theory context support the requested connection.",
        answer_text: "The cited research observation and reflected theory context support the requested connection.",
        goal_kind: "compound_research_locator",
        required_terminal_kind: "compound_research_locator_answer",
        support_refs: ["obs:scholarly"],
        artifact_refs: ["obs:scholarly"],
        authority: "llm_post_observation_compound_synthesis",
      },
    };
    const artifactLedger = [
      {
        artifact_id: "obs:scholarly",
        kind: "scholarly_research_observation",
        payload: { schema: "helix.scholarly_research_observation.v1" },
      },
      {
        artifact_id: "obs:reflection",
        kind: "helix_theory_context_reflection_tool_receipt",
        payload: { schema: "helix.theory_context_reflection_tool_receipt.v1" },
      },
      finalAnswerDraft,
    ];
    const payload: Record<string, unknown> = {
      route_product_contract: {
        source_target: "scholarly_research",
        allowed_terminal_artifact_kinds: ["compound_research_locator_answer"],
      },
      compound_capability_contract: {
        subgoals: [
          {
            requested_capability: "scholarly-research.lookup_papers",
            capability_family: "scholarly_research",
          },
          {
            requested_capability: "helix_ask.reflect_theory_context",
            capability_family: "theory_locator",
          },
        ],
      },
      compound_capability_synthesis_readiness: {
        applies: true,
        complete: true,
        support_refs: ["obs:scholarly", "obs:reflection"],
        required_terminal_kind: "compound_research_locator_answer",
        synthesis_terminal_kind: "compound_research_locator_answer",
      },
      capability_itinerary: {
        execution_state: {
          complete: true,
          required_observation_families: ["scholarly_research", "theory_locator"],
          compound_subgoal_ledger: [
            {
              requested_capability: "scholarly-research.lookup_papers",
              executed_capability: "scholarly-research.lookup_papers",
              observation_kind: "scholarly_research_observation",
              observation_ref: "obs:scholarly",
              satisfaction: "satisfied",
              rail_status: "complete",
            },
            {
              requested_capability: "helix_ask.reflect_theory_context",
              executed_capability: "helix_ask.reflect_theory_context",
              observation_kind: "helix_theory_context_reflection_tool_receipt",
              observation_ref: "obs:reflection",
              satisfaction: "satisfied",
              rail_status: "complete",
            },
          ],
        },
      },
      current_turn_artifact_ledger: artifactLedger,
    };

    const result = materializeFinalAnswerDraftTerminal({
      turnId,
      payload,
      artifactLedger,
      routeProductContract: payload.route_product_contract as Record<string, unknown>,
      finalAnswerDraftRef: `${turnId}:final_answer_draft`,
    });

    expect(result).toMatchObject({
      ok: true,
      materialized_terminal_artifact_kind: "compound_research_locator_answer",
    });
    expect(payload.compound_research_locator_answer).toMatchObject({
      support_refs: ["obs:scholarly", "obs:reflection"],
      support_refs_count: 2,
      subgoal_observation_refs: ["obs:scholarly", "obs:reflection"],
      subgoal_observation_refs_count: 2,
      source_families: ["scholarly_research", "theory_locator"],
    });
  });

  it("recognizes top-level compound execution state when materializing research locator answers", () => {
    const turnId = "ask:test:compound-research-locator-top-level-state";
    const finalAnswerDraft = {
      artifact_id: `${turnId}:final_answer_draft`,
      kind: "final_answer_draft",
      payload: {
        schema: "helix.final_answer_draft.v1",
        text: "The web research and reflected theory context support the requested synthesis.",
        answer_text: "The web research and reflected theory context support the requested synthesis.",
        goal_kind: "compound_research_locator",
        required_terminal_kind: "compound_research_locator_answer",
        support_refs: ["obs:web"],
        artifact_refs: ["obs:web"],
        authority: "llm_post_observation_compound_synthesis",
      },
    };
    const artifactLedger = [
      {
        artifact_id: "obs:web",
        kind: "internet_search_observation",
        payload: { schema: "helix.internet_search_observation.v1" },
      },
      {
        artifact_id: "obs:reflection",
        kind: "helix_theory_context_reflection_tool_receipt",
        payload: { schema: "helix.theory_context_reflection_tool_receipt.v1" },
      },
      finalAnswerDraft,
    ];
    const payload: Record<string, unknown> = {
      route_product_contract: {
        source_target: "internet_search",
        allowed_terminal_artifact_kinds: ["compound_research_locator_answer"],
      },
      compound_capability_synthesis_readiness: {
        applies: true,
        complete: true,
        support_refs: ["obs:web", "obs:reflection"],
        required_terminal_kind: "compound_research_locator_answer",
        synthesis_terminal_kind: "compound_research_locator_answer",
      },
      capability_itinerary: {
        schema: "helix.capability_itinerary.v1",
      },
      capability_itinerary_execution_state: {
        complete: true,
        required_observation_families: ["internet_search", "theory_locator"],
        compound_subgoal_ledger: [
          {
            requested_capability: "internet_search.web_research",
            executed_capability: "internet-search.search_web",
            observation_kind: "internet_search_observation",
            observation_ref: "obs:web",
            satisfaction: "satisfied",
            rail_status: "complete",
          },
          {
            requested_capability: "helix_ask.reflect_theory_context",
            executed_capability: "helix_ask.reflect_theory_context",
            observation_kind: "helix_theory_context_reflection_tool_receipt",
            observation_ref: "obs:reflection",
            satisfaction: "satisfied",
            rail_status: "complete",
          },
        ],
      },
      current_turn_artifact_ledger: artifactLedger,
    };

    const result = materializeFinalAnswerDraftTerminal({
      turnId,
      payload,
      artifactLedger,
      routeProductContract: payload.route_product_contract as Record<string, unknown>,
      finalAnswerDraftRef: `${turnId}:final_answer_draft`,
    });

    expect(result).toMatchObject({
      ok: true,
      materialized_terminal_artifact_kind: "compound_research_locator_answer",
    });
    expect(payload.compound_research_locator_answer).toMatchObject({
      support_refs: ["obs:web", "obs:reflection"],
      support_refs_count: 2,
      subgoal_observation_refs: ["obs:web", "obs:reflection"],
      subgoal_observation_refs_count: 2,
      source_families: ["internet_search", "theory_locator"],
    });
  });

  it("materializes research plus reflection plus calculator as compound evidence synthesis", () => {
    const turnId = "ask:test:internet-reflection-calculator-materializer";
    const finalAnswerDraft = {
      artifact_id: `${turnId}:final_answer_draft`,
      kind: "final_answer_draft",
      payload: {
        schema: "helix.final_answer_draft.v1",
        text: "The web research, theory reflection, and calculator observations jointly support the final synthesis.",
        answer_text: "The web research, theory reflection, and calculator observations jointly support the final synthesis.",
        goal_kind: "compound_evidence_synthesis",
        required_terminal_kind: "compound_evidence_synthesis_answer",
        support_refs: ["obs:web", "obs:reflection", "obs:calculator"],
        artifact_refs: ["obs:web", "obs:reflection", "obs:calculator"],
        authority: "llm_post_observation_compound_synthesis",
      },
    };
    const artifactLedger = [
      {
        artifact_id: "obs:web",
        kind: "internet_search_observation",
        payload: { schema: "helix.internet_search_observation.v1" },
      },
      {
        artifact_id: "obs:reflection",
        kind: "helix_theory_context_reflection_tool_receipt",
        payload: { schema: "helix.theory_context_reflection_tool_receipt.v1" },
      },
      {
        artifact_id: "obs:calculator",
        kind: "calculator_receipt",
        payload: { schema: "helix.calculator_receipt.v1" },
      },
      finalAnswerDraft,
    ];
    const payload: Record<string, unknown> = {
      route_product_contract: {
        source_target: "internet_search",
        allowed_terminal_artifact_kinds: [
          "compound_evidence_synthesis_answer",
          "model_synthesized_answer",
          "tool_receipt",
          "calculator_receipt",
        ],
      },
      capability_itinerary: {
        terminal_success_criteria: {
          requires_post_observation_synthesis: true,
          compound_terminal_policy: "synthesize_from_satisfied_subgoal_observations",
          allowed_terminal_artifact_kinds: [
            "compound_evidence_synthesis_answer",
            "model_synthesized_answer",
            "tool_receipt",
            "calculator_receipt",
          ],
          forbidden_terminal_artifact_kinds: [
            "tool_receipt",
            "calculator_receipt",
          ],
        },
      },
      compound_capability_synthesis_readiness: {
        applies: true,
        complete: true,
        support_refs: ["obs:web", "obs:reflection", "obs:calculator"],
        required_terminal_kind: "compound_evidence_synthesis_answer",
        synthesis_terminal_kind: "compound_evidence_synthesis_answer",
      },
      capability_itinerary_execution_state: {
        complete: true,
        required_observation_families: ["internet_search", "theory_locator", "calculator"],
        compound_subgoal_ledger: [
          {
            requested_capability: "internet_search.web_research",
            executed_capability: "internet-search.search_web",
            observation_kind: "internet_search_observation",
            observation_ref: "obs:web",
            satisfaction: "satisfied",
            rail_status: "complete",
          },
          {
            requested_capability: "helix_ask.reflect_theory_context",
            executed_capability: "helix_ask.reflect_theory_context",
            observation_kind: "helix_theory_context_reflection_tool_receipt",
            observation_ref: "obs:reflection",
            satisfaction: "satisfied",
            rail_status: "complete",
          },
          {
            requested_capability: "scientific-calculator.solve_expression",
            executed_capability: "scientific-calculator.solve_expression",
            observation_kind: "calculator_receipt",
            observation_ref: "obs:calculator",
            satisfaction: "satisfied",
            rail_status: "complete",
          },
        ],
      },
      current_turn_artifact_ledger: artifactLedger,
    };

    const result = materializeFinalAnswerDraftTerminal({
      turnId,
      payload,
      artifactLedger,
      routeProductContract: payload.route_product_contract as Record<string, unknown>,
      finalAnswerDraftRef: `${turnId}:final_answer_draft`,
    });

    expect(result).toMatchObject({
      ok: true,
      materialized_terminal_artifact_kind: "compound_evidence_synthesis_answer",
    });
    expect(result.route_allowed_terminal_artifact_kinds).toContain("compound_evidence_synthesis_answer");
    expect(result.route_allowed_terminal_artifact_kinds).not.toContain("tool_receipt");
    expect(result.route_allowed_terminal_artifact_kinds).not.toContain("calculator_receipt");
    expect(payload.compound_research_locator_answer).toBeUndefined();
    expect(payload.compound_evidence_synthesis_answer).toMatchObject({
      support_refs: ["obs:web", "obs:reflection", "obs:calculator"],
      support_refs_count: 3,
      subgoal_observation_refs: ["obs:web", "obs:reflection", "obs:calculator"],
      subgoal_observation_refs_count: 3,
      source_families: ["internet_search", "theory_locator", "calculator"],
      model_step_capability: "model.synthesize_from_compound_subgoal_observations",
    });
  });

  it("materializes civilization bounds plus moral graph reflection as compound evidence synthesis", () => {
    const turnId = "ask:test:civilization-moral-compound-materializer";
    const civilizationSubgoalId =
      `${turnId}:compound_capability_subgoal:1:helix_ask_reflect_civilization_bounds`;
    const moralSubgoalId =
      `${turnId}:compound_capability_subgoal:2:helix_ask_reflect_ideology_context`;
    const finalAnswerDraft = {
      artifact_id: `${turnId}:final_answer_draft`,
      kind: "final_answer_draft",
      payload: {
        schema: "helix.final_answer_draft.v1",
        text: "The civilization bounds roadmap and moral graph reflection jointly support the final synthesis.",
        answer_text: "The civilization bounds roadmap and moral graph reflection jointly support the final synthesis.",
        goal_kind: "compound_evidence_synthesis",
        required_terminal_kind: "compound_evidence_synthesis_answer",
        support_refs: ["obs:civilization-bounds", "obs:moral-reflection"],
        artifact_refs: ["obs:civilization-bounds", "obs:moral-reflection"],
        authority: "llm_post_observation_compound_synthesis",
      },
    };
    const artifactLedger = [
      {
        artifact_id: "obs:civilization-bounds",
        kind: "helix_civilization_bounds_tool_result",
        payload: {
          schema: "helix.civilization_bounds_roadmap_tool_result.v1",
          capability_key: "helix_ask.reflect_civilization_bounds",
          compound_subgoal_id: civilizationSubgoalId,
        },
      },
      {
        artifact_id: "obs:moral-reflection",
        kind: "helix_moral_graph_reflection_tool_result",
        payload: {
          schema: "helix.ideology_context_reflection_tool_result.v1",
          capability_key: "helix_ask.reflect_ideology_context",
          compound_subgoal_id: moralSubgoalId,
        },
      },
      finalAnswerDraft,
    ];
    const payload: Record<string, unknown> = {
      route_product_contract: {
        source_target: "civilization_bounds",
        allowed_terminal_artifact_kinds: [
          "compound_evidence_synthesis_answer",
          "model_synthesized_answer",
          "tool_receipt",
          "helix_civilization_bounds_tool_result",
          "helix_moral_graph_reflection_tool_result",
        ],
      },
      capability_itinerary: {
        terminal_success_criteria: {
          requires_post_observation_synthesis: true,
          compound_terminal_policy: "synthesize_from_satisfied_subgoal_observations",
          required_observation_families: ["civilization_bounds", "moral_graph_reflection"],
          required_capabilities: [
            "helix_ask.reflect_civilization_bounds",
            "helix_ask.reflect_ideology_context",
          ],
          allowed_terminal_artifact_kinds: [
            "compound_evidence_synthesis_answer",
            "model_synthesized_answer",
            "tool_receipt",
            "helix_civilization_bounds_tool_result",
            "helix_moral_graph_reflection_tool_result",
          ],
          forbidden_terminal_artifact_kinds: [
            "tool_receipt",
            "helix_civilization_bounds_tool_result",
            "helix_moral_graph_reflection_tool_result",
          ],
        },
      },
      compound_capability_synthesis_readiness: {
        applies: true,
        complete: true,
        support_refs: ["obs:civilization-bounds", "obs:moral-reflection"],
        required_terminal_kind: "compound_evidence_synthesis_answer",
        synthesis_terminal_kind: "compound_evidence_synthesis_answer",
      },
      compound_capability_contract: {
        schema: "helix.compound_capability_contract.v1",
        requires_all_subgoals: true,
        terminal_policy: "synthesize_from_satisfied_subgoal_observations",
        subgoals: [
          {
            subgoal_id: civilizationSubgoalId,
            capability_family: "civilization_bounds",
            requested_capability: "helix_ask.reflect_civilization_bounds",
            runtime_capability: "helix_ask.reflect_civilization_bounds",
            required_observation_kinds: ["civilization_bounds_roadmap/v1"],
            required_terminal_kind: "model_synthesized_answer",
            terminal_contribution_kind: "model_synthesized_answer",
            mandatory: true,
          },
          {
            subgoal_id: moralSubgoalId,
            capability_family: "moral_graph_reflection",
            requested_capability: "helix_ask.reflect_ideology_context",
            runtime_capability: "helix_ask.reflect_ideology_context",
            required_observation_kinds: ["ideology_context_reflection/v1"],
            required_terminal_kind: "model_synthesized_answer",
            terminal_contribution_kind: "model_synthesized_answer",
            mandatory: true,
          },
        ],
      },
      capability_itinerary_execution_state: {
        applies: true,
        complete: true,
        required_observation_families: ["civilization_bounds", "moral_graph_reflection"],
        observed_families: ["civilization_bounds", "moral_graph_reflection"],
        compound_subgoal_ledger: [
          {
            subgoal_id: civilizationSubgoalId,
            requested_capability: "helix_ask.reflect_civilization_bounds",
            runtime_capability: "helix_ask.reflect_civilization_bounds",
            selected_capability: "helix_ask.reflect_civilization_bounds",
            executed_capability: "helix_ask.reflect_civilization_bounds",
            args: { prompt: "Assess long-range civilization bounds." },
            observation_kind: "helix_civilization_bounds_tool_result",
            observation_ref: "obs:civilization-bounds",
            support_refs: ["obs:civilization-bounds"],
            satisfaction: "satisfied",
            rail_status: "complete",
            terminal_contribution_kind: "model_synthesized_answer",
          },
          {
            subgoal_id: moralSubgoalId,
            requested_capability: "helix_ask.reflect_ideology_context",
            runtime_capability: "helix_ask.reflect_ideology_context",
            selected_capability: "helix_ask.reflect_ideology_context",
            executed_capability: "helix_ask.reflect_ideology_context",
            args: { text: "Reflect the review-policy implications." },
            observation_kind: "helix_moral_graph_reflection_tool_result",
            observation_ref: "obs:moral-reflection",
            support_refs: ["obs:moral-reflection"],
            satisfaction: "satisfied",
            rail_status: "complete",
            terminal_contribution_kind: "model_synthesized_answer",
          },
        ],
      },
      current_turn_artifact_ledger: artifactLedger,
    };

    const result = materializeFinalAnswerDraftTerminal({
      turnId,
      payload,
      artifactLedger,
      routeProductContract: payload.route_product_contract as Record<string, unknown>,
      finalAnswerDraftRef: `${turnId}:final_answer_draft`,
    });

    expect(result).toMatchObject({
      ok: true,
      materialized_terminal_artifact_kind: "compound_evidence_synthesis_answer",
    });
    expect(result.route_allowed_terminal_artifact_kinds).toContain("compound_evidence_synthesis_answer");
    expect(result.route_allowed_terminal_artifact_kinds).not.toContain("tool_receipt");
    expect(result.route_allowed_terminal_artifact_kinds).not.toContain("helix_civilization_bounds_tool_result");
    expect(result.route_allowed_terminal_artifact_kinds).not.toContain("helix_moral_graph_reflection_tool_result");
    expect(payload.compound_evidence_synthesis_answer).toMatchObject({
      support_refs: ["obs:civilization-bounds", "obs:moral-reflection"],
      support_refs_count: 2,
      subgoal_observation_refs: ["obs:civilization-bounds", "obs:moral-reflection"],
      subgoal_observation_refs_count: 2,
      source_families: ["civilization_bounds", "moral_graph_reflection"],
      model_step_capability: "model.synthesize_from_compound_subgoal_observations",
    });
  });
});
