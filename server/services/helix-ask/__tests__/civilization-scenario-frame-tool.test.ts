import { describe, expect, it } from "vitest";
import { validateCivilizationBoundsRoadmapV1 } from "../../../../shared/civilization-bounds-roadmap";
import { validateCivilizationScenarioFrameV1 } from "../../../../shared/civilization-scenario-frame";
import {
  civilizationScenarioFrameSpec,
  HELIX_ASK_CIVILIZATION_SCENARIO_FRAME_TOOL_NAME,
  runHelixAskCivilizationScenarioFrameTool,
} from "../../../skills/helix-ask.civilization-scenario-frame";
import { runHelixAskCivilizationBoundsTool } from "../../../skills/helix-ask.civilization-bounds-roadmap";
import { evaluateWorkstationToolReceipt } from "../workstation-tool-evaluator";
import { planWorkstationToolUse } from "../workstation-tool-planner";

describe("Helix Ask Civilization Scenario Frame tool", () => {
  it("classifies planetary trade prompts into bounded scenario grammar", async () => {
    const output = await runHelixAskCivilizationScenarioFrameTool({
      prompt:
        "Generate a civilization bounds frame for planetary trade: suppliers, material inventory, transport latency, treaty governance, and review.",
      refs: ["turn:test"],
    });

    expect(validateCivilizationScenarioFrameV1(output.frame)).toEqual([]);
    expect(output.frame.schemaVersion).toBe("civilization_scenario_frame/v1");
    expect(output.frame.family).toBe("planetary_trade");
    expect(output.frame.boundaryKind).toBe("planetary_civilization");
    expect(output.frame.developmentalStage).toBe("planetary_coordination");
    expect(output.frame.constraintProfiles).toEqual(
      expect.arrayContaining(["material_limited", "transport_limited", "governance_limited"]),
    );
    expect(output.frame.evidenceMode).toBe("user_hypothesis");
    expect(output.missingEvidence).toEqual(expect.arrayContaining(["material_inventory_receipts"]));
    expect(output.frame.authority).toMatchObject({
      terminal_eligible: false,
      agent_executable: false,
      scenario_finality: false,
      policy_finality: false,
    });
  });

  it("keeps Spore-like generated societies fictional unless receipts upgrade claims", async () => {
    const output = await runHelixAskCivilizationScenarioFrameTool({
      prompt:
        "Use a Spore-like fictional multi species ecology with tribal coordination, waste sinks, consent limits, and declared rules.",
      refs: ["turn:test"],
    });

    expect(output.frame.family).toBe("ecological_civilization");
    expect(output.frame.evidenceMode).toBe("fictional_construct");
    expect(output.frame.constraintProfiles).toEqual(
      expect.arrayContaining(["ecological_sink_limited", "consent_limited", "observability_limited"]),
    );
    expect(output.frame.boundedActorGrammar.blockedMoveKinds).toEqual(
      expect.arrayContaining(["treat generated frame as observed reality"]),
    );
  });

  it("keeps conflict resource-capacity prompts out of the machine civilization preset", async () => {
    const output = await runHelixAskCivilizationScenarioFrameTool({
      prompt:
        "Frame a regional conflict recovery scenario where marginal battlefield cost, defensive denial capacity, infrastructure stability, resource reserves, and buildout rates constrain decision maker claims across countries.",
    });

    expect(output.frame.family).toBe("resource_reconstruction");
    expect(output.frame.family).not.toBe("machine_or_digital_civilization");
    expect(output.frame.boundaryKind).toBe("planetary_civilization");
    expect(output.frame.coordinationMode).toBe("treaty");
    expect(output.frame.constraintProfiles).toEqual(
      expect.arrayContaining(["material_limited", "transport_limited", "governance_limited"]),
    );
  });

  it("evaluates scenario frames as evidence-only receipts", async () => {
    const output = await runHelixAskCivilizationScenarioFrameTool({
      prompt: "Build a machine civilization frame with compute, cooling, signal latency, and audit review.",
      refs: ["turn:test"],
    });
    const evaluation = evaluateWorkstationToolReceipt({
      thread_id: "thread:civilization-frame",
      turn_id: "turn:civilization-frame",
      receipt: {
        ok: true,
        receipt_id: "receipt:civilization-frame",
        kind: "helix_civilization_scenario_frame_tool_result",
        artifact: {
          kind: "helix_civilization_scenario_frame_tool_result",
          tool_id: HELIX_ASK_CIVILIZATION_SCENARIO_FRAME_TOOL_NAME,
          ...output,
        },
        evidence_refs: ["turn:test", output.frame.frameId],
      },
    });

    expect(evaluation.result).toBe("supports_subgoal");
    expect(evaluation.summary).toContain("Civilization Scenario Frame produced evidence-only bounded-system grammar");
  });

  it("drives sparse roadmap generation instead of the declared Needle preset", async () => {
    const frameOutput = await runHelixAskCivilizationScenarioFrameTool({
      prompt:
        "Generate a civilization bounds frame for planetary trade: suppliers, material inventory, transport latency, treaty governance, and review.",
      refs: ["turn:test"],
    });
    const roadmapOutput = await runHelixAskCivilizationBoundsTool({
      prompt: "Reflect this through civilization bounds.",
      scenarioFrame: frameOutput.frame,
      refs: ["turn:test", frameOutput.frame.frameId],
      options: {
        includeBridgeContext: true,
        includeCollaborationBounds: true,
        includeFalsificationHooks: true,
      },
    });

    expect(validateCivilizationBoundsRoadmapV1(roadmapOutput.roadmap)).toEqual([]);
    expect(roadmapOutput.roadmap.scenarioId).toBe(frameOutput.frame.frameId);
    expect(roadmapOutput.roadmap.title).toContain("Sparse Civilization Bounds");
    expect(roadmapOutput.roadmap.badges.map((badge) => badge.label)).toEqual(
      expect.arrayContaining([
        "Material inventory unknown",
        "Transport route and latency unknown",
        "Governance interface unknown",
        "Collaboration value unavailable until evidence supplied",
      ]),
    );
    expect(roadmapOutput.roadmap.missingEvidence).toEqual(
      expect.arrayContaining(["material_inventory_receipts", "collaboration_factor_measurements"]),
    );
    expect(roadmapOutput.parameterScopes.map((scope) => scope.kind)).toEqual(
      expect.arrayContaining(["material_base", "governance_institutional_capacity", "security_conflict_exposure"]),
    );
    expect(roadmapOutput.dependencyChains.map((chain) => chain.chainId)).toEqual(
      expect.arrayContaining([expect.stringContaining("constraint_profile")]),
    );
    expect(roadmapOutput.comparisonCases.map((comparison) => comparison.sourceClass)).toEqual(
      expect.arrayContaining(["historical_case", "current_snapshot"]),
    );
    expect(roadmapOutput.hypothesisClaims.map((claim) => claim.claimId)).toEqual(
      expect.arrayContaining(["hypothesis:dependency_bottleneck", "hypothesis:comparison_not_prediction"]),
    );
    expect(roadmapOutput.scenarioFrame?.schemaVersion).toBe("civilization_scenario_frame/v1");
  });

  it("plans civilization bounds through the scenario-frame step", () => {
    const plan = planWorkstationToolUse(
      "Reflect this as a civilization bounds roadmap for planetary trade with material inventory, transport, governance review, and missing evidence.",
    );

    expect(plan.intent).toBe("civilization_bounds_reflection");
    expect(plan.tool_plan?.steps.map((step) => step.step_id)).toEqual(
      expect.arrayContaining(["build_civilization_scenario_frame", "reflect_civilization_bounds"]),
    );
    expect(plan.tool_plan?.steps.find((step) => step.step_id === "reflect_civilization_bounds")?.depends_on).toEqual(
      expect.arrayContaining(["build_civilization_scenario_frame"]),
    );
  });

  it("registers as deterministic non-privileged diagnostic tool metadata", () => {
    expect(civilizationScenarioFrameSpec.name).toBe(HELIX_ASK_CIVILIZATION_SCENARIO_FRAME_TOOL_NAME);
    expect(civilizationScenarioFrameSpec.deterministic).toBe(true);
    expect(civilizationScenarioFrameSpec.risk).toMatchObject({
      writesFiles: false,
      touchesNetwork: false,
      privileged: false,
    });
    expect(civilizationScenarioFrameSpec.provenance).toMatchObject({
      maturity: "diagnostic",
      certifying: false,
      metadataComplete: true,
      sourceClass: "declared",
    });
  });
});
