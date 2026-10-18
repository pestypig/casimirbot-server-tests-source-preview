import { describe, expect, it } from "vitest";
import { validateCivilizationBoundsRoadmapV1 } from "../../../../shared/civilization-bounds-roadmap";
import { validateCivilizationTraversabilityAtlasV1 } from "../../../../shared/civilization-traversability-atlas";
import { planWorkstationToolUse } from "../workstation-tool-planner";
import { evaluateWorkstationToolReceipt } from "../workstation-tool-evaluator";
import { evaluateWorkstationToolPlan } from "../workstation-tool-result-evaluator";
import { synthesizeWorkstationToolAnswer } from "../workstation-answer-synthesizer";
import {
  civilizationBoundsRoadmapSpec,
  HELIX_ASK_CIVILIZATION_BOUNDS_TOOL_NAME,
  runHelixAskCivilizationBoundsTool,
} from "../../../skills/helix-ask.civilization-bounds-roadmap";

describe("Helix Ask Civilization Bounds Roadmap tool", () => {
  it("returns a valid evidence-only roadmap and bridge context", async () => {
    const output = await runHelixAskCivilizationBoundsTool({
      prompt: "Reflect this as a civilization bounds roadmap.",
      options: {
        includeBridgeContext: true,
        includeCollaborationBounds: true,
        includeFalsificationHooks: true,
      },
    });

    expect(validateCivilizationBoundsRoadmapV1(output.roadmap)).toEqual([]);
    expect(validateCivilizationTraversabilityAtlasV1(output.traversabilityAtlas)).toEqual([]);
    expect(output.roadmap.authority).toMatchObject({
      assistant_answer: false,
      terminal_eligible: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
      agent_executable: false,
      prediction_finality: false,
      policy_finality: false,
      moral_finality: false,
      execution_permission: false,
    });
    expect(output.authority).toMatchObject(output.roadmap.authority);
    expect(output.missingEvidenceBoundaries).toEqual(
      expect.arrayContaining(["source_backed_capacity_measurements"]),
    );
    expect(output.analogyBoundaries).toEqual(
      expect.arrayContaining([
        "Procedural analogies can suggest flow, dependency, and bottleneck questions; they do not prove organism-level agency.",
      ]),
    );
    expect(output.supportRefs).toEqual(
      expect.arrayContaining([output.roadmap.roadmapId, output.traversabilityAtlas.atlasId]),
    );
    expect(output.parameterScopes.map((scope) => scope.kind)).toEqual(
      expect.arrayContaining([
        "material_base",
        "governance_institutional_capacity",
        "security_conflict_exposure",
      ]),
    );
    expect(output.actionChannels.map((channel) => channel.kind)).toEqual(
      expect.arrayContaining(["economic", "coercive", "persuasive", "observation"]),
    );
    expect(output.proceduralScaffold.scaffoldId).toBe("spore_civilization_stage_procedural_scaffold");
    expect(output.proceduralScaffold.blockedInterpretations).toEqual(
      expect.arrayContaining(["Spore mechanics are not a history model."]),
    );
    expect(output.bridgeContext?.systemIds.length).toBeGreaterThan(0);
    expect(output.bridgeContext?.missingEvidence).toContain("source_backed_capacity_measurements");
    expect(output.traversabilityContext.routeCandidateIds).toEqual(
      expect.arrayContaining([
        "route:atmospheric:sahara-amazon:dust",
        "route:air:jfk-fra:wind-adjusted",
      ]),
    );
    expect(output.traversabilityContext.evidenceRefs).toContain(output.traversabilityAtlas.atlasId);
    expect(output.traversabilityContext.routeObjective).toBe("best_observed");
  });

  it("returns a traversability context ordered by route objective and selected layers", async () => {
    const output = await runHelixAskCivilizationBoundsTool({
      prompt: "Reflect planetary traversability for the dust teleconnection.",
      selectedRouteIds: ["route:atmospheric:sahara-amazon:dust"],
      selectedFieldLayerIds: ["field:sahara-amazon:dust-phosphorus"],
      routeObjective: "best_observed",
      timeCursor: "2026-07-01T00:00:00.000Z",
    });

    expect(output.traversabilityContext).toMatchObject({
      routeCandidateIds: ["route:atmospheric:sahara-amazon:dust"],
      activeFieldLayerIds: ["field:sahara-amazon:dust-phosphorus"],
      routeObjective: "best_observed",
      timeCursor: "2026-07-01T00:00:00.000Z",
    });
    expect(output.traversabilityContext.infrastructureNodeIds).toEqual([
      "node:dust:bodele",
      "node:ecology:amazon-basin",
    ]);
    expect(output.traversabilityContext.moralNodeIds).toContain("interbeing-systems");
    expect(output.traversabilityContext.theoryBadgeIds).toContain(
      "biophysics.membrane.open_system_entropy_flow",
    );
    expect(output.traversabilityContext.missingEvidence).toEqual(
      expect.arrayContaining(["current_year_plume_observation"]),
    );
  });

  it("can be evaluated as non-terminal civilization-bounds evidence", async () => {
    const output = await runHelixAskCivilizationBoundsTool({
      prompt: "Compare collaboration constraints through civilization bounds.",
      options: { includeBridgeContext: true },
    });
    const evaluation = evaluateWorkstationToolReceipt({
      thread_id: "thread:civilization-bounds",
      turn_id: "turn:civilization-bounds",
      receipt: {
        ok: true,
        receipt_id: "receipt:civilization-bounds",
        kind: "helix_civilization_bounds_tool_result",
        artifact: {
          kind: "helix_civilization_bounds_tool_result",
          tool_id: HELIX_ASK_CIVILIZATION_BOUNDS_TOOL_NAME,
          ...output,
        },
        evidence_refs: ["turn:civilization-bounds", output.roadmap.roadmapId],
      },
    });

    expect(evaluation.result).toBe("supports_subgoal");
    expect(evaluation.summary).toContain("Civilization Bounds Roadmap produced evidence-only system bounds");
  });

  it("plans the bounds route without stealing ordinary world-map prompts", () => {
    const ordinary = planWorkstationToolUse("What country is this on the world map?");
    expect(ordinary.intent).not.toBe("civilization_bounds_reflection");

    const plan = planWorkstationToolUse(
      "Reflect this as a civilization bounds roadmap: compare energy budget, material inventory, manufacturing resolution, governance review, and Moral procedural gates.",
    );
    expect(plan.intent).toBe("civilization_bounds_reflection");
    expect(plan.tool_plan?.steps.map((step) => step.step_id)).toContain("reflect_civilization_bounds");
    expect(plan.tool_plan?.steps.map((step) => step.step_id)).toContain("build_civilization_scenario_frame");
    expect(plan.tool_plan?.steps.some((step) => step.tool_id === HELIX_ASK_CIVILIZATION_BOUNDS_TOOL_NAME)).toBe(true);
  });

  it("keeps loose metaphors and ordinary concept questions model-led", () => {
    const prompts = [
      "Is global trade like a circulatory system?",
      "Is the internet like a nervous system?",
      "Can you compare a government to an organism in a short answer?",
      "What does it mean when people call society an ecosystem?",
    ];

    for (const prompt of prompts) {
      const plan = planWorkstationToolUse(prompt);
      expect(plan.intent).not.toBe("civilization_bounds_reflection");
      expect(plan.tool_plan?.steps.some((step) => step.step_id === "reflect_civilization_bounds")).not.toBe(true);
    }
  });

  it("admits grounded procedural-world comparisons as evidence only", () => {
    const plan = planWorkstationToolUse(
      "Ground the global trade as circulatory system comparison against civilization bounds: trade routes, chokepoints, ports, missing evidence, and dependency edges.",
    );

    expect(plan.intent).toBe("civilization_bounds_reflection");
    expect(plan.reason).toContain("diagnostic roadmap receipt before synthesis");
    expect(plan.tool_plan?.steps.map((step) => step.step_id)).toEqual(
      expect.arrayContaining([
        "build_civilization_scenario_frame",
        "reflect_civilization_bounds",
        "evaluate_civilization_bounds",
      ]),
    );
    expect(plan.tool_plan?.steps.some((step) => step.tool_id === HELIX_ASK_CIVILIZATION_BOUNDS_TOOL_NAME)).toBe(true);
  });

  it("admits live or source-backed world-map grounding without making the map authoritative", () => {
    const plan = planWorkstationToolUse(
      "Map this against the procedural world model using live measurements, tectonic plates, weather fronts, infrastructure routes, and missing source evidence.",
    );

    expect(plan.intent).toBe("civilization_bounds_reflection");
    expect(plan.tool_plan?.steps.map((step) => step.step_id)).toContain("reflect_civilization_bounds");
  });

  it("keeps Theory-Moral bridge continuity when bounds cues are present", () => {
    const plan = planWorkstationToolUse(
      "Use the Theory Moral bridge with civilization bounds for entropy, conservation, material inventory, fairness, and review.",
    );
    expect(plan.intent).toBe("civilization_bounds_reflection");
    expect(plan.tool_plan?.steps.map((step) => step.step_id)).toEqual(
      expect.arrayContaining([
        "reflect_theory_context",
        "reflect_moral_graph_context",
        "build_civilization_scenario_frame",
        "reflect_civilization_bounds",
        "bridge_theory_ideology_context",
      ]),
    );
  });

  it("synthesizes the receipt as situational bounds rather than a decision", () => {
    const prompt =
      "Reflect this as a civilization bounds roadmap: compare energy budget, material inventory, manufacturing resolution, governance review, and Moral procedural gates.";
    const plan = planWorkstationToolUse(prompt).tool_plan;
    expect(plan).toBeTruthy();
    const evaluation = evaluateWorkstationToolPlan({
      plan,
      receipt_ids: ["receipt:civilization-bounds"],
      evidence_refs: ["receipt:civilization-bounds"],
      summary:
        "Civilization Bounds Roadmap produced evidence-only system bounds, capability/dependency badges, collaboration constraints, and missing-evidence hooks.",
      supports_goal: true,
    });
    const answer = synthesizeWorkstationToolAnswer({
      prompt,
      plan: plan!,
      evaluation,
    });
    expect(answer).toContain("situational bounds receipt");
    expect(answer).toContain("does not decide what should happen");
    expect(answer).not.toMatch(/physics proves morality|morally certain/i);
  });

  it("registers as deterministic non-privileged diagnostic tool metadata", () => {
    expect(civilizationBoundsRoadmapSpec.name).toBe(HELIX_ASK_CIVILIZATION_BOUNDS_TOOL_NAME);
    expect(civilizationBoundsRoadmapSpec.deterministic).toBe(true);
    expect(civilizationBoundsRoadmapSpec.risk).toMatchObject({
      writesFiles: false,
      touchesNetwork: false,
      privileged: false,
    });
    expect(civilizationBoundsRoadmapSpec.provenance).toMatchObject({
      maturity: "diagnostic",
      certifying: false,
      metadataComplete: true,
      sourceClass: "declared",
    });
  });
});
