import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HELIX_THEORY_CONTEXT_REFLECTION_CAPABILITY,
  HELIX_THEORY_CONTEXT_REFLECTION_LEGACY_ALIASES,
} from "../services/helix-ask/theory-congruence/capability-contract";
import {
  callWorkstationGatewayCapability,
  listWorkstationGatewayCapabilities,
} from "../services/helix-ask/workstation-tool-gateway/registry";
import { buildPromptNamedCapabilityGatewayCallRequests } from
  "../services/helix-ask/agent-providers/prompt-named-tool-requests";

const legacyCapability = HELIX_THEORY_CONTEXT_REFLECTION_LEGACY_ALIASES[0];

const readObservation = (value: unknown): Record<string, any> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("canonical open-world theory reflection gateway", () => {
  it("advertises the Ask-owned capability and keeps the panel action as an input alias only", () => {
    const listed = listWorkstationGatewayCapabilities({ mode: "read", agentRuntime: "codex" });
    const ids = listed.capabilities.map((capability) => capability.capability_id);

    expect(ids).toContain(HELIX_THEORY_CONTEXT_REFLECTION_CAPABILITY);
    expect(ids).not.toContain(legacyCapability);
  });

  it("classifies Godel incompleteness and Fermat Last Theorem as outside this graph", async () => {
    vi.stubEnv("HELIX_ASK_THEORY_CONGRUENCE_TRACE", "shadow");
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: HELIX_THEORY_CONTEXT_REFLECTION_CAPABILITY,
      turnId: "turn:gateway:godel-fermat",
      arguments: {
        prompt:
          "LIVE_DERIVATION_PROGRAM_GODEL_07 Use helix_ask.reflect_theory_context exactly once " +
          "to compare Gödel incompleteness theorem with Fermat Last Theorem. " +
          "Report exact_badge_ids, likely_badge_ids, representedProbabilityMass, " +
          "outOfGraphProbability, master_problem_v1, derivation_program_v1, and failureReceipts.",
        conversation_context:
          "Retained context mentions Einstein field equations, stellar spectral abundance, photon energy, nucleosynthesis, nuclear structure, and surface gravity.",
        build_explanation_plan: true,
      },
    });
    const observation = readObservation(result.observation);

    expect(result.ok).toBe(true);
    expect(result.capability_id).toBe(HELIX_THEORY_CONTEXT_REFLECTION_CAPABILITY);
    expect(observation.exact_badge_ids).toEqual([]);
    expect(observation.likely_badge_ids).toEqual([]);
    expect(observation.open_world_uncertainty).toMatchObject({
      representedProbabilityMass: 0,
      outOfGraphProbability: 1,
      coverageBasis: "no_candidates",
      openWorldInterpretation: "includes_out_of_graph_hypothesis_not_truth_claim",
    });
    expect(observation.probability_semantics).toEqual({
      badge_probability_by_id:
        "conditional_distribution_within_represented_candidates_not_scientific_truth",
      open_world_candidate_probability_by_id:
        "joint_placement_mass_including_out_of_graph_hypothesis_not_scientific_truth",
      represented_probability_mass:
        "semantic_graph_coverage_heuristic_not_validation_probability",
      out_of_graph_probability:
        "unrepresented_semantic_placement_mass_not_evidence_against_the_claim",
      entropy:
        "uncertainty_of_locator_placement_distribution_not_physical_system_entropy",
    });
    expect(observation.match_authority_semantics).toEqual({
      exact_and_likely: "semantic_locator_status_not_scientific_validation",
      rejected: "scientific_authority_gate_status_not_semantic_mismatch",
      axes_are_independent: true,
    });
    expect(observation.theory_congruence_trace_v1).toMatchObject({
      schema: "helix.theory_congruence_trace.v1",
      assistant_answer: false,
      terminal_eligible: false,
    });
    expect(observation.master_problem_v1).toMatchObject({
      artifactId: "theory_master_problem",
      claimBoundary: {
        assistantAnswer: false,
        terminalEligible: false,
        completedSolverPathRequired: true,
      },
    });
    expect(observation.derivation_program_v1).toMatchObject({
      artifactId: "theory_derivation_program",
      status: "blocked",
      solverRoute: {
        family: "none",
        admission: "blocked",
        executorOwner: "agent_runtime",
      },
      failureReceipts: [expect.objectContaining({ code: "insufficient_evidence" })],
      claimBoundary: {
        temporaryProgram: true,
        executesTools: false,
        assistantAnswer: false,
        terminalEligible: false,
        completedSolverPathRequired: true,
      },
    });
  });

  it("maps Einstein field equations to conservation badges and compiles an explicit comparison request", async () => {
    vi.stubEnv("HELIX_ASK_THEORY_CONGRUENCE_TRACE", "shadow");
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: legacyCapability,
      turnId: "turn:gateway:einstein-conservation",
      arguments: {
        prompt: "Compare the Einstein field equation with stress-energy conservation at the same observable scale.",
        operation: "compare",
        target: "Einstein field equation and stress-energy conservation",
        target_observable: "nabla_mu_T_mu_nu",
        evidence_maturity_ceiling: "diagnostic",
      },
    });
    const observation = readObservation(result.observation);

    expect(result.ok).toBe(true);
    expect(result.capability_id).toBe(HELIX_THEORY_CONTEXT_REFLECTION_CAPABILITY);
    expect(observation.exact_badge_ids).toEqual(expect.arrayContaining([
      "physics.gr.einstein_field_equation",
      "physics.gr.stress_energy_conservation",
    ]));
    expect(observation.exact_badge_ids).toHaveLength(2);
    expect(observation.exact_badge_ids).not.toContain("physics.symmetry.energy_momentum_conservation");
    expect(observation.likely_badge_ids).toContain("physics.symmetry.energy_momentum_conservation");
    expect(observation.open_world_uncertainty.coverageBasis).toBe("semantic_coverage_heuristic");
    expect(observation.open_world_uncertainty.outOfGraphProbability).toBeLessThan(0.1);
    expect(observation.master_problem_v1.request).toMatchObject({
      operation: "compare",
      targetObservable: "nabla_mu_T_mu_nu",
      normalizationStatus: "explicit",
    });
    expect(observation.master_problem_v1.observableResolution).toMatchObject({
      targetObservableId: "nabla_mu_T_mu_nu",
      status: "blocked",
    });
    expect(observation.master_problem_v1.compile).toMatchObject({
      status: "unidentifiable",
      allowedResultKinds: ["unresolved"],
      runtimeAdmission: "blocked",
    });
    expect(observation.derivation_program_v1).toMatchObject({
      status: "blocked",
      solverRoute: { family: "none", admission: "blocked" },
    });
    expect(observation.derivation_program_v1.failureReceipts).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "observable_unidentifiable" })]),
    );
    expect(observation.derivation_program_v1.failureReceipts).toHaveLength(1);
    expect(observation.legacy_alias_capability_ids).toContain(legacyCapability);
    expect(observation.canonical_capability_id).toBe(HELIX_THEORY_CONTEXT_REFLECTION_CAPABILITY);
    expect(result.tool_lifecycle_trace.requested_capability).toBe(
      HELIX_THEORY_CONTEXT_REFLECTION_CAPABILITY,
    );
    expect(result.tool_lifecycle_trace.executed_capability).toBe(
      HELIX_THEORY_CONTEXT_REFLECTION_CAPABILITY,
    );
  });

  it("preserves explicit prompt-named derivation fields through the gateway", async () => {
    vi.stubEnv("HELIX_ASK_THEORY_CONGRUENCE_TRACE", "shadow");
    const question =
      "Use helix_ask.reflect_theory_context exactly once. operation=compare; " +
      "target=Einstein field equation and stress-energy conservation; " +
      "target_observable=nabla_mu_T_mu_nu; coordinate_frame=local_orthonormal; " +
      "evidence_maturity_ceiling=diagnostic. Report exact_badge_ids and derivation_program_v1.";
    const request = buildPromptNamedCapabilityGatewayCallRequests({ question })[0];
    const requestArguments = readObservation(request?.arguments);

    expect(request).toMatchObject({
      capability_id: HELIX_THEORY_CONTEXT_REFLECTION_CAPABILITY,
      mode: "read",
    });
    expect(requestArguments).toMatchObject({
      prompt: "Einstein field equation and stress-energy conservation",
      operation: "compare",
      target_observable: "nabla_mu_T_mu_nu",
      coordinate_frame: "local_orthonormal",
      evidence_maturity_ceiling: "diagnostic",
    });

    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: String(request?.capability_id ?? ""),
      turnId: "turn:gateway:prompt-named-gr",
      arguments: requestArguments,
    });
    const observation = readObservation(result.observation);

    expect(observation.exact_badge_ids).toEqual([
      "physics.gr.stress_energy_conservation",
      "physics.gr.einstein_field_equation",
    ]);
    expect(observation.master_problem_v1.request).toMatchObject({
      operation: "compare",
      targetObservable: "nabla_mu_T_mu_nu",
      coordinateFrame: "local_orthonormal",
      evidenceMaturityCeiling: "diagnostic",
      normalizationStatus: "explicit",
    });
    expect(observation.master_problem_v1.compile.status).toBe("unidentifiable");
    expect(observation.derivation_program_v1).toMatchObject({
      status: "blocked",
      solverRoute: { family: "none", admission: "blocked" },
    });
  });

  it("compiles an exact closed-form constant without contextual badge inflation", async () => {
    vi.stubEnv("HELIX_ASK_THEORY_CONGRUENCE_TRACE", "shadow");
    const question =
      "Use helix_ask.reflect_theory_context exactly once. operation=derive; " +
      "target=physics.constants.speed_of_light; target_observable=c; " +
      "evidence_maturity_ceiling=certified. Report exact_badge_ids and derivation_program_v1.";
    const request = buildPromptNamedCapabilityGatewayCallRequests({ question })[0];
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: String(request?.capability_id ?? ""),
      turnId: "turn:gateway:prompt-named-speed-of-light",
      arguments: readObservation(request?.arguments),
    });
    const observation = readObservation(result.observation);

    expect(observation.exact_badge_ids).toEqual(["physics.constants.speed_of_light"]);
    expect(observation.master_problem_v1).toMatchObject({
      selectedBadgeIds: ["physics.constants.speed_of_light"],
      request: {
        operation: "derive",
        targetObservable: "c",
        evidenceMaturityCeiling: "certified",
        normalizationStatus: "explicit",
      },
      compile: {
        status: "executable",
        missingBindings: [],
        runtimeAdmission: "eligible_for_completed_solver_path",
      },
    });
    expect(observation.derivation_program_v1).toMatchObject({
      status: "ready",
      solverRoute: {
        family: "symbolic_algebra",
        admission: "admitted",
        executorOwner: "agent_runtime",
        postToolModelStepRequired: true,
      },
      failureReceipts: [],
    });
    expect(observation.derivation_program_v1.steps).toHaveLength(2);
  });

  it("locates a natural Cooper-pair referent as likely context without granting exact authority", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: HELIX_THEORY_CONTEXT_REFLECTION_CAPABILITY,
      turnId: "turn:gateway:natural-cooper-pair-context",
      arguments: {
        prompt: [
          "Cooper pairs are pairs of electrons that become weakly bound together inside certain materials at very low temperatures.",
          "A crystal-lattice distortion can produce an effective attraction that overcomes electron repulsion under the right conditions.",
          "Many Cooper pairs can occupy a coherent quantum state that moves without ordinary electrical resistance, creating superconductivity.",
          "Cooper pairing is central to conventional BCS superconductivity.",
        ].join(" "),
        conversation_context: "can you reflect this in theory badge graph?",
      },
    });
    const observation = readObservation(result.observation);
    const badgeId = "low_temp.superconductivity.zero_dc_resistance_bounds";

    expect(result.ok).toBe(true);
    expect(observation.exact_badge_ids).not.toContain(badgeId);
    expect(observation.likely_badge_ids).toContain(badgeId);
    expect(observation.open_world_uncertainty).toMatchObject({
      representedProbabilityMass: 0.55,
      outOfGraphProbability: 0.45,
      coverageBasis: "semantic_coverage_heuristic",
    });
    expect(observation.match_authority_semantics).toMatchObject({
      exact_and_likely: "semantic_locator_status_not_scientific_validation",
      axes_are_independent: true,
    });
  });

  it.each([
    ["contextual", "Explain what helix_ask.reflect_theory_context would do with operation=compare; do not execute it."],
    ["negated", "Do not run helix_ask.reflect_theory_context; operation=compare; target=GR."],
    ["future", "Later, use helix_ask.reflect_theory_context with operation=compare; target=GR."],
    ["historical", "Earlier we used helix_ask.reflect_theory_context with operation=compare; target=GR. What happened?"],
    ["quoted", "The phrase 'use helix_ask.reflect_theory_context operation=compare target=GR' is visible on screen."],
    ["mixed", "Review why the earlier helix_ask.reflect_theory_context operation=compare failed, but do not run it again."],
  ])("does not execute explicit assignments from %s capability mentions", (_label, question) => {
    expect(buildPromptNamedCapabilityGatewayCallRequests({ question })).toEqual([]);
  });
});
