import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildHelixAskTurnContractGoal } from "../services/helix-ask/contracts/turn-contract-goal";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/contracts/turn-contract-goal.ts");
const builderPath = join(repoRoot, "server/services/helix-ask/contracts/turn-contract-builder.ts");

describe("Helix Ask turn-contract goal extraction boundary", () => {
  it("keeps goal text precedence out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");
    const builderSource = readFileSync(builderPath, "utf8");

    expect(`${routeSource}\n${builderSource}`).toContain("turn-contract-goal");
    expect(routeSource).not.toContain("normalizeHelixAskTurnContractText(researchContract?.purpose ?? \"\", 180) ||");
    expect(serviceSource).toMatch(/export\s+const\s+buildHelixAskTurnContractGoal\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("preserves research, planner, question, and fallback precedence", () => {
    expect(
      buildHelixAskTurnContractGoal({
        researchPurpose: "  **Research purpose**  ",
        plannerGoal: "Planner goal",
        question: "Question goal",
      }),
    ).toBe("Research purpose");

    expect(
      buildHelixAskTurnContractGoal({
        researchPurpose: "",
        plannerGoal: "Planner goal",
        question: "Question goal",
      }),
    ).toBe("Planner goal");

    expect(
      buildHelixAskTurnContractGoal({
        researchPurpose: "",
        plannerGoal: "",
        question: "Question goal",
      }),
    ).toBe("Question goal");

    expect(
      buildHelixAskTurnContractGoal({
        researchPurpose: "",
        plannerGoal: "",
        question: "",
      }),
    ).toBe("Answer the current ask.");
  });
});
