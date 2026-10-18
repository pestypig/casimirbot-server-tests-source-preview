import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildHelixAskTurnContractPlannerSections,
  selectHelixAskTurnContractPlannerSectionSource,
} from "../services/helix-ask/contracts/turn-contract-planner-sections";
import type { PromptResearchContract } from "../services/helix-ask/prompt-research-contract";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/contracts/turn-contract-planner-sections.ts");
const builderPath = join(repoRoot, "server/services/helix-ask/contracts/turn-contract-builder.ts");

describe("Helix Ask turn-contract planner-sections extraction boundary", () => {
  it("keeps planner-section normalization out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");
    const builderSource = readFileSync(builderPath, "utf8");

    expect(`${routeSource}\n${builderSource}`).toContain("turn-contract-planner-sections");
    expect(routeSource).not.toContain("const plannerSections = plannerSectionSource.map((section) => ({");
    expect(routeSource).not.toContain("const plannerSectionSource = args.plannerPass?.sections?.length");
    expect(routeSource).not.toContain("buildHelixAskPromptResearchPlannerSections({");
    expect(serviceSource).toMatch(/export\s+const\s+buildHelixAskTurnContractPlannerSections\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+selectHelixAskTurnContractPlannerSectionSource\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("preserves planner-section defaults and normalization", () => {
    expect(
      buildHelixAskTurnContractPlannerSections([
        {
          title: "Evidence",
          required: undefined,
          must_answer: ["cover it"],
          required_slots: [" code path "],
          preferred_evidence: ["code", "bogus"],
          kind: "repo",
        },
        {
          required: false,
          preferred_evidence: ["doc"],
          kind: "unknown",
        },
      ]),
    ).toEqual([
      {
        id: "Evidence",
        title: "Evidence",
        required: true,
        must_answer: ["cover it"],
        required_slots: [" code path "],
        preferred_evidence: ["code"],
        kind: "repo",
        objective_label: null,
      },
      {
        id: "section",
        title: "Section",
        required: false,
        must_answer: [],
        required_slots: [],
        preferred_evidence: ["doc"],
        kind: "answer",
        objective_label: null,
      },
    ]);
  });

  it("preserves planner-section source precedence", () => {
    const plannerSections = [
      {
        id: "planner",
        title: "Planner Section",
      },
    ];
    const researchContract = {
      mode: "research_contract",
      raw_prompt: "",
      purpose: null,
      hard_constraints: [],
      verbatim_constraints: [],
      canonical_precedence: [],
      canonical_precedence_paths: [],
      required_repo_inputs: [],
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
          title: "Research Evidence",
          must_cover: ["cite the paper"],
        },
      ],
      appendix_requirements: [],
      provenance_table_schema: [],
      claim_discipline: [],
      fail_closed_behavior: {
        enabled: true,
        missing_required_inputs_stop: false,
        unknown_marker: "unknown",
        stop_reason: "missing",
      },
      self_check: [],
      section_titles: [],
      detection_signals: [],
    } satisfies PromptResearchContract;

    expect(
      selectHelixAskTurnContractPlannerSectionSource({
        plannerSections,
        researchContract: null,
        family: "definition_overview",
      }),
    ).toBe(plannerSections);

    expect(
      selectHelixAskTurnContractPlannerSectionSource({
        plannerSections,
        researchContract,
        family: "definition_overview",
      }).map((section) => section.title),
    ).toEqual(["Research Evidence"]);

    expect(
      selectHelixAskTurnContractPlannerSectionSource({
        plannerSections: null,
        researchContract: null,
        family: "definition_overview",
      }),
    ).toEqual([]);
  });
});
