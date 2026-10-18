import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { HELIX_ASK_ANSWER_PLAN_PROFILE_SECTIONS } from "../services/helix-ask/answer-plan";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/answer-plan.ts");

describe("Helix Ask answer-plan profile extraction boundary", () => {
  it("keeps answer-plan profile section ownership out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("HELIX_ASK_ANSWER_PLAN_PROFILE_SECTIONS");
    expect(routeSource).toContain("../services/helix-ask/answer-plan");
    expect(routeSource).not.toMatch(/const\s+HELIX_ASK_ANSWER_PLAN_PROFILE_SECTIONS\s*:/);
    expect(routeSource).not.toMatch(/const\s+createHelixAskAnswerPlanSection\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+HELIX_ASK_ANSWER_PLAN_PROFILE_SECTIONS\s*:/);
    expect(serviceSource).toMatch(/export\s+const\s+createHelixAskAnswerPlanSection\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("preserves profile coverage for each answer-plan family", () => {
    expect(Object.keys(HELIX_ASK_ANSWER_PLAN_PROFILE_SECTIONS).sort()).toEqual([
      "comparison_tradeoff",
      "definition_overview",
      "equation_formalism",
      "general_overview",
      "implementation_code_path",
      "mechanism_process",
      "recommendation_decision",
      "roadmap_planning",
      "troubleshooting_diagnosis",
    ]);
    for (const sections of Object.values(HELIX_ASK_ANSWER_PLAN_PROFILE_SECTIONS)) {
      expect(sections.length).toBeGreaterThan(0);
      expect(sections.some((section) => section.id === "sources")).toBe(true);
    }
  });

  it("preserves comparison profile code-path grounding input", () => {
    const differences = HELIX_ASK_ANSWER_PLAN_PROFILE_SECTIONS.comparison_tradeoff.find(
      (section) => section.id === "differences",
    );

    expect(differences).toMatchObject({
      title: "Key differences",
      required: true,
      kind: "comparison",
      required_slots: ["mechanism", "code-path"],
    });
  });
});
