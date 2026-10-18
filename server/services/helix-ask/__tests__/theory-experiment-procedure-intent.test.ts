import { describe, expect, it } from "vitest";

import { buildHelixCompoundCapabilityContract } from "../compound-capability-contract";
import {
  extractExplicitCapabilityContracts,
  explicitCapabilityContractForCapability,
} from "../explicit-capability-contract";
import {
  buildPromptDerivedInternetSearchGatewayCallRequests,
  buildPromptDerivedTheoryExperimentProcedureGatewayCallRequests,
} from "../agent-providers/prompt-named-tool-requests";
import { buildRouteProductContract } from "../route-product-contract";
import { resolveToolFamilyContract } from "../tool-family-contract";
import {
  THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY,
  buildTheoryExperimentProcedurePromptArguments,
  isAffirmativeTheoryExperimentProcedurePrompt,
} from "../theory-experiment-procedure-intent";

const BADGE_ID = "study.casimir_dp.evidence_map_stage3";
const COMPARISON_BADGE_ID = "physics.energy.energy_density";
const CASE_SENSITIVE_BADGE_ID = "nhm2.clock.centerline_tau_alpha_T";
const TWO_SEGMENT_BADGE_ID = "casimir.material_receipts";
const CASE_ID = "advection_diffusion_full_1d";

describe("Theory Experiment Procedure natural-language admission", () => {
  it.each([
    `Now prepare the seven-stage theory experiment procedure for badge ${BADGE_ID} using ${CASE_ID}. Prepare only; do not start downstream jobs.`,
    `Re-prepare that same bounded procedure for ${BADGE_ID} and ${CASE_ID} so its evidence is current for this turn. Do not start downstream work.`,
    `Prepare a first-principles comparison procedure for badges ${BADGE_ID} and ${COMPARISON_BADGE_ID}; do not execute anything.`,
    `Prepare a theory experiment procedure for badge ${BADGE_ID}, but configure Lanyon for an unregistered two-dimensional adaptive-mesh advection-diffusion case. Do not run code.`,
    "Use the theory experiment procedure to compare the Stage 3 evidence-map badge with the registered one-dimensional Lanyon advection-diffusion case. Prepare only.",
    "Prepare a seven-stage experiment plan for the Stage 3 Casimir-DP evidence map using the registered one-dimensional advection-diffusion example. Do not run anything.",
  ])("admits an affirmative, preparation-only request: %s", (prompt) => {
    expect(isAffirmativeTheoryExperimentProcedurePrompt(prompt)).toBe(true);
    expect(
      extractExplicitCapabilityContracts(prompt).map(
        (entry) => entry.contract.capability,
      ),
    ).toContain(THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY);
  });

  it.each([
    `Do not prepare a theory experiment procedure for badge ${BADGE_ID}; explain the label only.`,
    `Later we may prepare a theory experiment procedure for badge ${BADGE_ID}.`,
    `If the review passes, prepare the theory experiment procedure for badge ${BADGE_ID}.`,
    `Yesterday the agent prepared a theory experiment procedure for badge ${BADGE_ID}.`,
    `The screen says "Prepare a theory experiment procedure for badge ${BADGE_ID}."`,
    `The note quotes “Prepare a theory experiment procedure for badge ${BADGE_ID}.” Explain it only.`,
    `The note quotes ‘Use theory-experiment-procedure.prepare for badge ${BADGE_ID}.’ Explain the text only.`,
    `The note quotes «Prepare a theory experiment procedure for badge ${BADGE_ID}.» Explain it only.`,
    `Don’t prepare a theory experiment procedure for badge ${BADGE_ID}; explain the label only.`,
    `Explain what the theory experiment procedure capability means conceptually.`,
    "Prepare the database migration procedure for the release.",
    "Prepare a theory experiment procedure comparing literary theory workshop badges.",
    "Prepare a theory experiment procedure for the product badge roadmap.",
    "Configure a comparison procedure for employee training badges.",
    "Prepare a theory experiment procedure for badge fiction.award.shortlist.",
  ])(
    "does not admit contextual or non-scientific procedure text: %s",
    (prompt) => {
      expect(isAffirmativeTheoryExperimentProcedurePrompt(prompt)).toBe(false);
      expect(
        extractExplicitCapabilityContracts(prompt).map(
          (entry) => entry.contract.capability,
        ),
      ).not.toContain(THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY);
    },
  );

  it("binds canonical badges, operation, and a registered Lanyon case", () => {
    const prompt = `Prepare a seven-stage theory experiment procedure comparing badge ${BADGE_ID} with ${COMPARISON_BADGE_ID}, using Lanyon case ${CASE_ID}.`;
    expect(
      buildTheoryExperimentProcedurePromptArguments({ promptText: prompt }),
    ).toMatchObject({
      prompt,
      operation: "compare",
      target: `${BADGE_ID} vs ${COMPARISON_BADGE_ID}`,
      selected_badge_ids: [BADGE_ID, COMPARISON_BADGE_ID],
      evidence_maturity_ceiling: "exploratory",
      lanyon_requested: true,
      lanyon_case_id: CASE_ID,
    });
  });

  it("binds human-facing registered aliases to canonical procedure identities", () => {
    const prompt =
      "Prepare a seven-stage experiment plan for the Stage 3 Casimir-DP evidence map using the registered one-dimensional advection-diffusion example. Do not run anything.";
    expect(
      buildTheoryExperimentProcedurePromptArguments({ promptText: prompt }),
    ).toMatchObject({
      selected_badge_ids: [BADGE_ID],
      lanyon_requested: true,
      lanyon_case_id: CASE_ID,
      evidence_maturity_ceiling: "exploratory",
    });
    expect(
      buildPromptDerivedTheoryExperimentProcedureGatewayCallRequests({
        question: prompt,
      }),
    ).toHaveLength(1);
  });

  it("recognizes a canonical AdvectionDiffusion case id without a separate Lanyon label", () => {
    const prompt = `Prepare a theory experiment procedure for badge ${BADGE_ID} using ${CASE_ID}.`;
    expect(
      buildTheoryExperimentProcedurePromptArguments({ promptText: prompt }),
    ).toMatchObject({
      selected_badge_ids: [BADGE_ID],
      lanyon_requested: true,
      lanyon_case_id: CASE_ID,
    });
  });

  it("preserves registered badge namespaces and case", () => {
    const prompt =
      "Prepare a theory experiment procedure comparing badge " +
      "NHM2.CLOCK.CENTERLINE_TAU_ALPHA_T with ELEMENT.H.ORIGIN.";
    expect(
      buildTheoryExperimentProcedurePromptArguments({ promptText: prompt }),
    ).toMatchObject({
      operation: "compare",
      selected_badge_ids: [CASE_SENSITIVE_BADGE_ID, "element.h.origin"],
    });
  });

  it("accepts registered two-segment IDs and restores their canonical spelling", () => {
    const prompt = `Prepare a theory experiment procedure comparing badge CASIMIR.MATERIAL_RECEIPTS with ${BADGE_ID.toUpperCase()}.`;
    expect(
      buildTheoryExperimentProcedurePromptArguments({ promptText: prompt }),
    ).toMatchObject({
      operation: "compare",
      selected_badge_ids: [TWO_SEGMENT_BADGE_ID, BADGE_ID],
      target: `${TWO_SEGMENT_BADGE_ID} vs ${BADGE_ID}`,
    });
  });

  it("does not bind unregistered dotted tokens as Theory Badge Graph IDs", () => {
    const prompt = `Prepare a scientific theory experiment procedure for badge ${BADGE_ID} and fiction.award.shortlist.`;
    expect(
      buildTheoryExperimentProcedurePromptArguments({ promptText: prompt }),
    ).toMatchObject({
      selected_badge_ids: [BADGE_ID],
      target: BADGE_ID,
    });
  });

  it("does not turn negated scientific operations or adapters into procedure arguments", () => {
    const prompt = [
      `Prepare a bounded theory experiment procedure comparing badge ${BADGE_ID} with ${COMPARISON_BADGE_ID},`,
      "but do not prove anything and do not use Lanyon.",
    ].join(" ");
    expect(
      buildTheoryExperimentProcedurePromptArguments({ promptText: prompt }),
    ).toEqual(
      expect.objectContaining({
        operation: "compare",
        selected_badge_ids: [BADGE_ID, COMPARISON_BADGE_ID],
      }),
    );
    expect(
      buildTheoryExperimentProcedurePromptArguments({ promptText: prompt }),
    ).not.toHaveProperty("lanyon_requested");
  });

  it("keeps an exact comparison continuation as compare when the boundary says it is not proof", () => {
    const prompt = [
      "Continue that same comparison.",
      "Re-prepare the theory experiment procedure so its evidence is current for this turn.",
      "Identify the missing formal and numerical requirements; this is not proof.",
    ].join(" ");
    const retainedContextText = `Compared ${BADGE_ID} with ${COMPARISON_BADGE_ID}.`;

    expect(
      buildTheoryExperimentProcedurePromptArguments({
        promptText: prompt,
        retainedContextText,
      }),
    ).toMatchObject({
      operation: "compare",
      selected_badge_ids: [BADGE_ID, COMPARISON_BADGE_ID],
    });
  });

  it("keeps an affirmative equivalence proof request as prove even with two badges", () => {
    const prompt = `Prepare a theory experiment procedure to prove equivalence between badge ${BADGE_ID} and badge ${COMPARISON_BADGE_ID}.`;

    expect(
      buildTheoryExperimentProcedurePromptArguments({ promptText: prompt }),
    ).toMatchObject({
      operation: "prove",
      selected_badge_ids: [BADGE_ID, COMPARISON_BADGE_ID],
    });
  });

  it("does not globally treat prepare prose as an execution verb for other named tools", () => {
    expect(
      extractExplicitCapabilityContracts(
        "Prepare a report explaining docs.search; do not call any tools.",
      ),
    ).toHaveLength(0);
    expect(
      extractExplicitCapabilityContracts(
        "Prepare a comparison table that describes scientific-calculator.solve_expression.",
      ),
    ).toHaveLength(0);
  });

  it("binds a stable unsupported-case descriptor so the compiler fails closed", () => {
    const prompt = `Prepare a theory experiment procedure for badge ${BADGE_ID} using an unregistered two-dimensional adaptive-mesh advection-diffusion case.`;
    expect(
      buildTheoryExperimentProcedurePromptArguments({ promptText: prompt }),
    ).toMatchObject({
      selected_badge_ids: [BADGE_ID],
      lanyon_requested: true,
      lanyon_case_id: "unregistered_2d_adaptive_mesh_advection_diffusion",
    });
  });

  it("carries the exact observation and post-observation synthesis contract", () => {
    const contract = explicitCapabilityContractForCapability(
      THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY,
    );
    expect(contract).toMatchObject({
      capability_family: "theory_locator",
      plan_family: "theory_locator",
      source_target: "theory_locator",
      required_args: ["prompt", "operation", "target", "selected_badge_ids"],
      required_terminal_kind: "model_synthesized_answer",
    });
    expect(contract?.required_observation_kinds).toEqual([
      "theory_experiment_procedure_observation",
    ]);
  });

  it("projects the procedure observation through the theory route and tool family", () => {
    expect(
      resolveToolFamilyContract({
        toolName: THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY,
      }),
    ).toMatchObject({
      toolFamily: "theory_locator",
      authority: "evidence_only",
      mutating: false,
      requiredReentry: true,
    });
    const routeContract = buildRouteProductContract({
      turnId: "ask:test:theory-procedure-route",
      sourceTargetIntent: {
        target_source: "theory_locator",
      },
    });
    expect(routeContract.side_artifact_kinds_allowed).toContain(
      "theory_experiment_procedure_observation",
    );
    expect(routeContract.side_artifact_kinds_allowed).toContain(
      "theory_formal_verifier_preparation_observation",
    );
    expect(routeContract.allowed_terminal_artifact_kinds).toContain(
      "model_synthesized_answer",
    );
  });

  it("projects deterministic arguments into the capability subgoal", () => {
    const prompt = `Prepare a first-principles comparison procedure for badges ${BADGE_ID} and ${COMPARISON_BADGE_ID}.`;
    const contract = buildHelixCompoundCapabilityContract({
      turnId: "ask:test:theory-procedure",
      promptText: prompt,
    });
    expect(contract?.subgoals).toHaveLength(1);
    expect(contract?.subgoals[0]).toMatchObject({
      requested_capability: THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY,
      runtime_capability: THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY,
      args_hint: {
        operation: "compare",
        selected_badge_ids: [BADGE_ID, COMPARISON_BADGE_ID],
      },
      required_observation_kinds: expect.arrayContaining([
        "theory_experiment_procedure_observation",
      ]),
      required_terminal_kind: "model_synthesized_answer",
    });
  });

  it("reuses retained bindings for an affirmative same-comparison follow-up", () => {
    const question = [
      "Continue that same comparison.",
      "Re-prepare the procedure so its evidence is current for this turn,",
      "then identify the missing semantic, formal, numerical, and observable requirements.",
      "Do not start downstream jobs.",
    ].join(" ");
    const requests =
      buildPromptDerivedTheoryExperimentProcedureGatewayCallRequests({
        question,
        workspace_context_snapshot: {
          chat_referent_context: {
            previous_assistant_final_answer: {
              source_ref: "ask:test:prior:answer",
              text: [
                `Compared ${BADGE_ID} with ${COMPARISON_BADGE_ID}.`,
                `Pinned Lanyon case: ${CASE_ID}.`,
              ].join(" "),
            },
          },
        },
      });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      capability_id: THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY,
      mode: "read",
      arguments: {
        operation: "compare",
        selected_badge_ids: [BADGE_ID, COMPARISON_BADGE_ID],
        lanyon_requested: true,
        lanyon_case_id: CASE_ID,
        source_target_intent: {
          retained_context_ref: "ask:test:prior:answer",
          terminal_eligible: false,
          assistant_answer: false,
        },
      },
    });
  });

  it("does not append web search for current-turn procedure evidence", () => {
    const question = [
      `Re-prepare that same bounded procedure for ${BADGE_ID} and ${CASE_ID}`,
      "so the evidence is current for this turn.",
      "Which semantic, boundary-condition, formal, numerical, and observable requirements are still missing?",
      "Do not start any downstream job.",
    ].join(" ");

    expect(
      buildPromptDerivedTheoryExperimentProcedureGatewayCallRequests({
        question,
      }),
    ).toEqual([
      expect.objectContaining({
        capability_id: THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY,
      }),
    ]);
    expect(
      buildPromptDerivedInternetSearchGatewayCallRequests({ question }),
    ).toEqual([]);
  });

  it("keeps explicit web freshness as a separate admitted request", () => {
    const question = [
      `Re-prepare that same bounded procedure for ${BADGE_ID} and ${CASE_ID},`,
      "then search the web for the current OpenAI API status.",
    ].join(" ");

    expect(
      buildPromptDerivedInternetSearchGatewayCallRequests({ question }),
    ).toEqual([
      expect.objectContaining({
        capability_id: "internet-search.search_web",
      }),
    ]);
  });
});
