import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildHelixAskTurnContractPromptResearchSummary,
  selectHelixAskTurnContractPromptResearchContract,
  type HelixAskTurnContractPromptResearchSummary,
} from "../services/helix-ask/contracts/turn-contract-prompt-research-summary";
import type { PromptResearchContract } from "../services/helix-ask/prompt-research-contract";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(
  repoRoot,
  "server/services/helix-ask/contracts/turn-contract-prompt-research-summary.ts",
);
const builderPath = join(repoRoot, "server/services/helix-ask/contracts/turn-contract-builder.ts");

describe("Helix Ask turn-contract prompt-research summary extraction boundary", () => {
  it("keeps prompt-research summary projection out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");
    const builderSource = readFileSync(builderPath, "utf8");

    expect(`${routeSource}\n${builderSource}`).toContain("turn-contract-prompt-research-summary");
    expect(`${routeSource}\n${builderSource}`).toContain("selectHelixAskTurnContractPromptResearchContract(args.promptResearchContract)");
    expect(routeSource).not.toContain("args.promptResearchContract?.mode === \"research_contract\"");
    expect(routeSource).not.toContain("required_top_level_titles: researchContract.required_top_level_structure");
    expect(serviceSource).toMatch(/export\s+const\s+buildHelixAskTurnContractPromptResearchSummary\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+selectHelixAskTurnContractPromptResearchContract\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("preserves prompt-research summary field order, caps, and booleans", () => {
    const contract = {
      mode: "research_contract",
      verbatim_constraints: ["v1", "v2", "v3", "v4", "v5"],
      provenance_table_schema: Array.from({ length: 14 }, (_, index) => `col-${index + 1}`),
      required_top_level_structure: Array.from({ length: 14 }, (_, index) => ({
        title: `Section ${index + 1}`,
        must_cover: [],
      })),
      appendix_requirements: ["derive"],
      claim_discipline: ["qualify"],
      self_check: ["check"],
      fail_closed_behavior: {
        unknown_marker: "UNKNOWN",
      },
    } as PromptResearchContract;

    expect(buildHelixAskTurnContractPromptResearchSummary(contract)).toEqual({
      mode: "research_contract",
      verbatim_constraints: ["v1", "v2", "v3", "v4"],
      provenance_table_schema: Array.from({ length: 12 }, (_, index) => `col-${index + 1}`),
      required_top_level_titles: Array.from({ length: 12 }, (_, index) => `Section ${index + 1}`),
      appendix_required: true,
      claim_discipline_required: true,
      self_check_required: true,
      unknown_marker: "UNKNOWN",
    } satisfies HelixAskTurnContractPromptResearchSummary);
  });

  it("preserves null summary when no research contract is active", () => {
    expect(buildHelixAskTurnContractPromptResearchSummary(null)).toBeNull();
  });

  it("preserves active prompt-research contract mode selection", () => {
    const activeContract = {
      mode: "research_contract",
      verbatim_constraints: [],
      provenance_table_schema: [],
      required_top_level_structure: [],
      appendix_requirements: [],
      claim_discipline: [],
      self_check: [],
      fail_closed_behavior: {
        unknown_marker: "UNKNOWN",
      },
    } as PromptResearchContract;
    const defaultContract = {
      ...activeContract,
      mode: "default",
    } as PromptResearchContract;

    expect(selectHelixAskTurnContractPromptResearchContract(activeContract)).toBe(activeContract);
    expect(selectHelixAskTurnContractPromptResearchContract(defaultContract)).toBeNull();
    expect(selectHelixAskTurnContractPromptResearchContract(null)).toBeNull();
  });
});
