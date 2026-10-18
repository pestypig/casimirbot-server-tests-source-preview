import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  appendHelixRuntimeGoalSatisfactionObservation,
  collectHelixLoopMissingRequirementIds,
} from "../services/helix-ask/runtime/runtime-goal-satisfaction-observation";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/runtime/runtime-goal-satisfaction-observation.ts");

const dependencies = {
  readString: (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null),
  hashPayloadShort: () => "goal-hash",
  mergeLedgerArtifacts: <T>(artifacts: T[]): T[] => artifacts,
  resolveDebugEvidenceRequirementPolicy: () => ({
    schema: "helix.debug_evidence_requirement_policy.v1",
    requirement_source: null,
    suppressed: false,
    suppression_reason: null,
    docs_terminal_ready: false,
    doc_summary_ref: null,
    assistant_answer: false,
    raw_content_included: false,
  }),
  applyDebugEvidenceRequirementPolicyToPayload: (payload: Record<string, unknown>, policy: Record<string, unknown>) => {
    payload.debug_evidence_requirement_policy = policy;
  },
  nowMs: () => 1234,
};

describe("Helix Ask runtime goal-satisfaction observation extraction boundary", () => {
  it("keeps runtime goal-satisfaction observation implementation out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/runtime/runtime-goal-satisfaction-observation");
    expect(routeSource).not.toMatch(/^const\s+collectHelixLoopMissingRequirementIds\s*=/m);
    expect(routeSource).not.toMatch(/^const\s+appendHelixRuntimeGoalSatisfactionObservation\s*=/m);
    expect(routeSource).not.toMatch(/^type\s+HelixRuntimeGoalSatisfactionObservation\s*=/m);
    expect(serviceSource).toMatch(/export\s+const\s+collectHelixLoopMissingRequirementIds\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+appendHelixRuntimeGoalSatisfactionObservation\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("preserves missing-requirement collection side effects", () => {
    const payload: Record<string, unknown> = {
      calculator_plan_coverage: {
        missing_requirement_ids: ["calculator_receipt"],
        required_items: [
          { id: "calculator_expression", satisfied: false },
          { id: "already_satisfied", satisfied: true },
        ],
      },
    };

    expect(
      collectHelixLoopMissingRequirementIds({
        payload,
        goalSatisfactionEvaluation: {
          satisfaction: "not_satisfied",
          next_decision: "continue",
          required_actions: [{ action_key: "scientific-calculator.solve_expression", satisfied: false }],
          required_evidence: [{ kind: "workstation_tool_evaluation", satisfied: false }],
        },
        satisfactionReport: {
          missing_artifacts: ["doc_evidence_synthesis_answer"],
        },
        dependencies,
      }),
    ).toEqual([
      "calculator_receipt",
      "calculator_expression",
      "scientific-calculator.solve_expression",
      "workstation_tool_evaluation",
      "doc_evidence_synthesis_answer",
    ]);
    expect(payload.debug_evidence_requirement_policy).toMatchObject({
      schema: "helix.debug_evidence_requirement_policy.v1",
      suppressed: false,
    });
  });

  it("preserves observation artifact and payload/debug append side effects", () => {
    const payload: Record<string, unknown> = {
      current_turn_artifact_ledger: [],
      runtime_goal_satisfaction_observations: [],
      debug: {},
    };
    const result = appendHelixRuntimeGoalSatisfactionObservation({
      payload,
      turnId: "turn-1",
      iteration: 2,
      trigger: "runtime_tool_observation",
      triggeringArtifactRefs: ["artifact-1"],
      currentTurnArtifacts: [],
      goalSatisfactionEvaluation: {
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
      dependencies,
    });

    expect(result.observation).toMatchObject({
      schema: "helix.runtime_goal_satisfaction_observation.v1",
      observation_id: "turn-1:runtime_goal_satisfaction_observation:2:goal-hash",
      trigger: "runtime_tool_observation",
      triggering_artifact_refs: ["artifact-1"],
      satisfaction: "satisfied",
      next_decision: "allow_terminal",
      model_must_review: true,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.artifact).toMatchObject({
      artifact_id: "turn-1:runtime_goal_satisfaction_observation:2:goal-hash",
      kind: "runtime_goal_satisfaction_observation",
      producer_item_id: "agent_runtime_goal_satisfaction",
      created_at_ms: 1234,
      goal_hash: "goal-hash",
    });
    expect(payload.current_turn_artifact_ledger).toEqual([result.artifact]);
    expect(payload.runtime_goal_satisfaction_observations).toEqual([result.observation]);
    expect((payload.debug as Record<string, unknown>).current_turn_artifact_ledger).toEqual([result.artifact]);
  });
});
