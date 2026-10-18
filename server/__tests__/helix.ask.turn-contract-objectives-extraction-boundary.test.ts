import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildHelixAskTurnContractFallbackObjectiveLabels,
  buildHelixAskTurnContractObjectives,
  buildHelixAskTurnContractResearchObjectiveInputs,
  selectHelixAskTurnContractObjectiveInputs,
} from "../services/helix-ask/contracts/turn-contract-objectives";
import type { PromptResearchContract } from "../services/helix-ask/prompt-research-contract";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/contracts/turn-contract-objectives.ts");
const builderPath = join(repoRoot, "server/services/helix-ask/contracts/turn-contract-builder.ts");

describe("Helix Ask turn-contract objectives extraction boundary", () => {
  it("keeps objective normalization out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");
    const builderSource = readFileSync(builderPath, "utf8");

    expect(`${routeSource}\n${builderSource}`).toContain("turn-contract-objectives");
    expect(routeSource).not.toContain("const objectives = objectiveInputs\n    .map((entry) => {");
    expect(`${routeSource}\n${builderSource}`).toContain("buildHelixAskTurnContractResearchObjectiveInputs({");
    expect(routeSource).not.toContain("const researchObjectiveInputs = researchContract\n    ? buildHelixAskPromptResearchObjectiveInputs({");
    expect(`${routeSource}\n${builderSource}`).toContain("buildHelixAskTurnContractFallbackObjectiveLabels({");
    expect(routeSource).not.toContain("const fallbackObjectiveLabels = researchObjectiveInputs.length\n    ? []");
    expect(`${routeSource}\n${builderSource}`).toContain("selectHelixAskTurnContractObjectiveInputs({");
    expect(routeSource).not.toContain("? args.plannerPass.objectives\n        : fallbackObjectiveLabels.map");
    expect(routeSource).not.toContain("return {\n        label,\n        required_slots: requiredSlots,\n        query_hints: queryHints,\n      } satisfies HelixAskTurnContractObjective;");
    expect(serviceSource).toMatch(/export\s+const\s+buildHelixAskTurnContractResearchObjectiveInputs\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+buildHelixAskTurnContractFallbackObjectiveLabels\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+buildHelixAskTurnContractObjectives\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+selectHelixAskTurnContractObjectiveInputs\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("preserves objective normalization, slot fallback, query hints, and fallback objective", () => {
    expect(
      buildHelixAskTurnContractObjectives({
        objectiveInputs: [
          {
            label: "  API integration plan  ",
            required_slots: [" API Surface ", "api-surface"],
            query_hints: [" custom query ", "custom query"],
          },
        ],
        question: "fallback question",
        family: "implementation_code_path",
        groundingMode: "repo",
        maxObjectives: 4,
      }),
    ).toEqual([
      {
        label: "API integration plan",
        required_slots: ["api-surface", "integration"],
        query_hints: [
          "custom query",
          "API integration plan",
          "api endpoint integration plan",
          "integration",
          "integration implementation",
        ],
      },
    ]);

    expect(
      buildHelixAskTurnContractObjectives({
        objectiveInputs: [{ label: "   " }],
        question: "  ",
        family: "general_overview",
        groundingMode: "open",
        maxObjectives: 4,
      }),
    ).toEqual([
      {
        label: "Answer the current ask.",
        required_slots: ["current", "ask"],
        query_hints: ["Answer the current ask.", "current ask."],
      },
    ]);
  });

  it("preserves objective input precedence from research, planner, then fallback labels", () => {
    const researchObjectiveInputs = [{ label: "research objective" }];
    const plannerObjectiveInputs = [{ label: "planner objective" }];
    const fallbackObjectiveLabels = ["fallback objective"];

    expect(
      selectHelixAskTurnContractObjectiveInputs({
        researchObjectiveInputs,
        plannerObjectiveInputs,
        fallbackObjectiveLabels,
      }),
    ).toBe(researchObjectiveInputs);

    expect(
      selectHelixAskTurnContractObjectiveInputs({
        researchObjectiveInputs: [],
        plannerObjectiveInputs,
        fallbackObjectiveLabels,
      }),
    ).toBe(plannerObjectiveInputs);

    expect(
      selectHelixAskTurnContractObjectiveInputs({
        researchObjectiveInputs: [],
        plannerObjectiveInputs: [],
        fallbackObjectiveLabels,
      }),
    ).toEqual([{ label: "fallback objective" }]);
  });

  it("preserves fallback objective label suppression when research objectives exist", () => {
    expect(
      buildHelixAskTurnContractFallbackObjectiveLabels({
        hasResearchObjectiveInputs: true,
        question: "find alpha and beta; then cite gamma",
        maxObjectives: 4,
      }),
    ).toEqual([]);

    expect(
      buildHelixAskTurnContractFallbackObjectiveLabels({
        hasResearchObjectiveInputs: false,
        question: "find alpha and beta; then cite gamma",
        maxObjectives: 4,
      }),
    ).toEqual(["find alpha and beta; then cite gamma", "find alpha", "beta; then cite gamma"]);
  });

  it("preserves research-contract objective input assembly and null fallback", () => {
    const contract: PromptResearchContract = {
      mode: "research_contract",
      raw_prompt: "write the brief",
      purpose: "Explain the policy",
      hard_constraints: [],
      verbatim_constraints: [],
      canonical_precedence: [],
      canonical_precedence_paths: [],
      required_repo_inputs: ["runtime authority", "terminal authority"],
      allowed_extra_retrieval_rule: "none",
      output_style: {
        main_body_expectations: [],
        appendix_expectations: [],
        minimal_heading_overhead: false,
        continuous_prose: false,
        equation_dense: false,
      },
      required_top_level_structure: [
        {
          title: "Authority Route",
          must_cover: ["runtime authority", "terminal authority"],
        },
      ],
      appendix_requirements: ["derive constraints"],
      provenance_table_schema: [],
      claim_discipline: ["separate evidence from answer"],
      fail_closed_behavior: {
        enabled: true,
        missing_required_inputs_stop: true,
        unknown_marker: "unknown",
        stop_reason: "missing inputs",
      },
      self_check: ["check refs"],
      section_titles: [],
      detection_signals: [],
    };

    expect(
      buildHelixAskTurnContractResearchObjectiveInputs({
        researchContract: null,
        family: "implementation_code_path",
        groundingMode: "repo",
        maxObjectives: 4,
      }),
    ).toEqual([]);

    expect(
      buildHelixAskTurnContractResearchObjectiveInputs({
        researchContract: contract,
        family: "implementation_code_path",
        groundingMode: "repo",
        maxObjectives: 2,
      }),
    ).toEqual([
      {
        label: "Authority Route",
        required_slots: ["code_path", "authority", "route"],
        query_hints: [
          "Authority Route",
          "runtime authority",
          "terminal authority",
          "Authority Route runtime authority terminal authority",
          "authority route runtime",
        ],
      },
      {
        label: "Derivation Appendix",
        required_slots: ["mechanism", "equation", "derivation", "appendix"],
        query_hints: [
          "Derivation Appendix",
          "derive constraints",
          "runtime authority",
          "terminal authority",
          "Derivation Appendix derive constraints",
        ],
      },
    ]);
  });
});
