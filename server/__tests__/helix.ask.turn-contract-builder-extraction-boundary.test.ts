import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildHelixAskTurnContract } from "../services/helix-ask/contracts/turn-contract-builder";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/contracts/turn-contract-builder.ts");

describe("Helix Ask turn-contract builder extraction boundary", () => {
  it("keeps turn-contract field assembly out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/contracts/turn-contract-builder");
    expect(routeSource).not.toMatch(/const\s+buildHelixAskTurnContract\s*=\s*\(/);
    expect(routeSource).toContain("dependencies: HELIX_ASK_TURN_CONTRACT_BUILDER_DEPENDENCIES");
    expect(serviceSource).toMatch(/export\s+const\s+buildHelixAskTurnContract\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("preserves route-supplied classifiers while assembling the contract fields", () => {
    const contract = buildHelixAskTurnContract({
      question: "Explain how the runtime writes terminal authority.",
      intentDomain: "repo",
      requiresRepoEvidence: true,
      queryConstraints: {
        explicitAnchorPaths: ["server/routes/agi.plan.ts"],
      },
      equationPrompt: false,
      definitionFocus: false,
      equationIntentContract: null,
      plannerMode: "deterministic",
      plannerValid: true,
      plannerSource: "boundary_fixture",
      plannerPass: {
        goal: "Explain terminal authority wiring.",
        grounding_mode: "repo",
        output_family: "implementation_code_path",
        objectives: [{ label: "Trace terminal writer", required_slots: ["terminal authority"] }],
        required_slots: ["terminal authority"],
        query_hints: ["terminal authority writer"],
        sections: [{ title: "Implementation", required: true, kind: "repo" }],
      },
      promptResearchContract: null,
      maxObjectives: 4,
      maxRequiredSlots: 10,
      maxQueryHints: 16,
      version: "helix_turn_contract_v1",
      dependencies: {
        classifyFamily: () => "general_overview",
        classifySpecificity: () => "specific",
        isDefinitionRelationQuery: () => false,
        hasDefinitionRepoAnchorCue: () => false,
        buildObligations: ({ family, objectives, requiredSlots }) => [
          {
            id: "direct_answer",
            label: "Direct answer",
            kind: "direct_answer",
            required: true,
            required_slots: requiredSlots,
            preferred_evidence: family === "implementation_code_path" ? ["code"] : ["doc"],
            objective_label: objectives[0]?.label ?? null,
          },
        ],
      },
    });

    expect(contract).toMatchObject({
      version: "helix_turn_contract_v1",
      goal: "Explain terminal authority wiring.",
      grounding_mode: "repo",
      output_family: "implementation_code_path",
      prompt_specificity: "specific",
      planner: {
        mode: "deterministic",
        valid: true,
        source: "boundary_fixture",
      },
      constraints: {
        requires_repo_evidence: true,
        requires_citations: true,
        allow_open_world_bypass: false,
      },
    });
    expect(contract.objectives[0]?.label).toBe("Trace terminal writer");
    expect(contract.required_slots).toContain("terminal-authority");
    expect(contract.query_hints).toContain("terminal authority writer");
    expect(contract.obligations[0]?.preferred_evidence).toEqual(["code"]);
    expect(contract.answer_format.sections[0]?.title).toBe("Implementation");
  });
});
