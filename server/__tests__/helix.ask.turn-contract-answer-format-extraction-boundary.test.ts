import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildHelixAskTurnContractAnswerFormat } from "../services/helix-ask/contracts/turn-contract-answer-format";
import type { HelixAskAnswerPlanSection } from "../services/helix-ask/answer-plan";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/contracts/turn-contract-answer-format.ts");
const builderPath = join(repoRoot, "server/services/helix-ask/contracts/turn-contract-builder.ts");

describe("Helix Ask turn-contract answer-format extraction boundary", () => {
  it("keeps answer-format packaging out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");
    const builderSource = readFileSync(builderPath, "utf8");

    expect(`${routeSource}\n${builderSource}`).toContain("turn-contract-answer-format");
    expect(`${routeSource}\n${builderSource}`).toContain("answer_format: buildHelixAskTurnContractAnswerFormat({");
    expect(routeSource).not.toContain("answer_format: {\n      sections: plannerSections,\n      preferred_verbosity: args.plannerPass?.verbosity ?? null,\n    },");
    expect(serviceSource).toMatch(/export\s+const\s+buildHelixAskTurnContractAnswerFormat\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("preserves section identity and null-default verbosity", () => {
    const sections: HelixAskAnswerPlanSection[] = [
      {
        id: "answer",
        title: "Answer",
        required: true,
        must_answer: ["main point"],
        required_slots: ["result"],
        preferred_evidence: ["doc"],
        kind: "answer",
        objective_label: "Objective",
      },
    ];

    expect(
      buildHelixAskTurnContractAnswerFormat({
        sections,
        preferredVerbosity: "extended",
      }),
    ).toEqual({
      sections,
      preferred_verbosity: "extended",
    });

    expect(buildHelixAskTurnContractAnswerFormat({ sections })).toEqual({
      sections,
      preferred_verbosity: null,
    });
  });
});
