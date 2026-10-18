import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildHelixGoalSatisfactionEvaluationArtifact } from "../services/helix-ask/goal-satisfaction-artifact";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/goal-satisfaction-artifact.ts");

describe("Helix Ask goal satisfaction artifact extraction boundary", () => {
  it("keeps the reusable evaluation artifact builder out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/goal-satisfaction-artifact");
    expect(routeSource).not.toMatch(/const\s+buildHelixGoalSatisfactionEvaluationArtifact\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+buildHelixGoalSatisfactionEvaluationArtifact\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("builds the diagnostic ledger artifact without deciding satisfaction", () => {
    const evaluation = {
      schema: "helix.goal_satisfaction_evaluation.v1",
      satisfaction: "not_satisfied",
      next_decision: "retry",
    };

    expect(buildHelixGoalSatisfactionEvaluationArtifact({
      turnId: "turn-1",
      goalHash: "goal-hash",
      evaluation,
      createdAtMs: 123,
    })).toEqual({
      artifact_id: "turn-1:goal_satisfaction_evaluation",
      turn_id: "turn-1",
      producer_item_id: "goal_satisfaction_evaluator",
      kind: "goal_satisfaction_evaluation",
      created_at_ms: 123,
      source_scope: "current_turn",
      goal_hash: "goal-hash",
      payload: evaluation,
    });
  });
});
