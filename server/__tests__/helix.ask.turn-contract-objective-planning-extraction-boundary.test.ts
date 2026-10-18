import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildHelixAskPromptResearchObjectiveInputs,
  buildHelixAskPromptResearchPlannerSections,
  buildHelixAskTurnObjectiveQueryHints,
  buildHelixAskTurnObjectiveSlots,
  extractHelixAskTurnObjectiveFragments,
} from "../services/helix-ask/contracts/turn-contract-objective-planning";
import type { PromptResearchContract } from "../services/helix-ask/prompt-research-contract";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/contracts/turn-contract-objective-planning.ts");
const builderPath = join(repoRoot, "server/services/helix-ask/contracts/turn-contract-builder.ts");

const researchContract: PromptResearchContract = {
  mode: "research_contract",
  raw_prompt: "research contract",
  purpose: "Assemble proof boundaries",
  hard_constraints: [],
  verbatim_constraints: ["quote exact boundaries"],
  canonical_precedence: [],
  required_repo_inputs: ["server/routes/agi.plan.ts"],
  canonical_precedence_paths: ["docs/helix-ask-codex-loop-discipline.md"],
  allowed_extra_retrieval_rule: "anchor_expansion",
  output_style: {
    main_body_expectations: [],
    appendix_expectations: [],
    minimal_heading_overhead: false,
    continuous_prose: false,
    equation_dense: false,
  },
  required_top_level_structure: [
    {
      title: "Boundary Evidence",
      must_cover: ["terminal authority", "runtime proof"],
    },
  ],
  appendix_requirements: ["show derivation"],
  provenance_table_schema: ["claim", "source"],
  claim_discipline: ["separate receipts from answers"],
  self_check: ["verify all required slots"],
  fail_closed_behavior: {
    enabled: true,
    missing_required_inputs_stop: true,
    unknown_marker: "UNKNOWN",
    stop_reason: "missing inputs",
  },
  section_titles: [],
  detection_signals: [],
};

describe("Helix Ask turn-contract objective-planning extraction boundary", () => {
  it("keeps deterministic objective-planning helpers out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");
    const builderSource = readFileSync(builderPath, "utf8");

    expect(`${routeSource}\n${builderSource}`).toContain("turn-contract-objective-planning");
    expect(routeSource).not.toMatch(/const\s+extractHelixAskTurnObjectiveFragments\s*=/);
    expect(routeSource).not.toMatch(/const\s+buildHelixAskTurnObjectiveSlots\s*=/);
    expect(routeSource).not.toMatch(/const\s+buildHelixAskTurnObjectiveQueryHints\s*=/);
    expect(routeSource).not.toMatch(/const\s+buildHelixAskPromptResearchObjectiveInputs\s*=/);
    expect(routeSource).not.toMatch(/const\s+buildHelixAskPromptResearchPlannerSections\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+extractHelixAskTurnObjectiveFragments\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+buildHelixAskTurnObjectiveSlots\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+buildHelixAskTurnObjectiveQueryHints\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+buildHelixAskPromptResearchObjectiveInputs\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+buildHelixAskPromptResearchPlannerSections\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("preserves objective fragments, slots, query hints, and prompt-research projection shape", () => {
    expect(
      extractHelixAskTurnObjectiveFragments(
        "Explain the API endpoint. Also cover voice lane implementation and storage history.",
        4,
      ),
    ).toEqual([
      "Explain the API endpoint.",
      "Also cover voice lane implementation and storage history.",
    ]);

    expect(buildHelixAskTurnObjectiveSlots("voice lane implementation", "roadmap_planning")).toEqual([
      "repo-mapping",
      "implementation-touchpoints",
      "voice-lane",
      "code_path",
    ]);

    expect(buildHelixAskTurnObjectiveQueryHints("workspace_os.status implementation", "repo", "implementation_code_path"))
      .toContain("workspace_os.status implementation");

    expect(
      buildHelixAskPromptResearchObjectiveInputs({
        contract: researchContract,
        family: "implementation_code_path",
        groundingMode: "repo",
        maxObjectives: 3,
      })[0],
    ).toMatchObject({
      label: "Boundary Evidence",
      required_slots: expect.arrayContaining(["code_path"]),
      query_hints: expect.arrayContaining(["Boundary Evidence"]),
    });

    expect(
      buildHelixAskPromptResearchPlannerSections({
        contract: researchContract,
        family: "implementation_code_path",
      })[0],
    ).toMatchObject({
      id: "boundary_evidence",
      title: "Boundary Evidence",
      required: true,
      preferred_evidence: expect.arrayContaining(["code"]),
      kind: "repo",
    });
  });
});
