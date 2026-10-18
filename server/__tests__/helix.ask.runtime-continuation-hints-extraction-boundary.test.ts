import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  appendHelixRuntimeContinuationHintsToPayload,
  buildHelixRuntimeContinuationHint,
  collectHelixAgentStepDecisionsFromPayload,
  collectHelixRuntimeObservationRefsForHint,
  helixRuntimeHintMatchesAgentStepDecision,
  markHelixRuntimeContinuationHintsMigratedToAgentRuntimeLoop,
} from "../services/helix-ask/runtime/runtime-continuation-hints";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/runtime/runtime-continuation-hints.ts");

const dependencies = {
  capabilityKeyForAction: (action: any): string | null =>
    action?.panel_id === "docs-viewer" && action?.action_id === "locate_in_doc"
      ? "docs-viewer.locate_in_doc"
      : null,
  normalizeWorkspaceDocPath: (value: unknown): string | null =>
    typeof value === "string" && value.trim() ? value.trim().replace(/\\/g, "/") : null,
  readArtifactPayloadRecord: (artifact: any): Record<string, unknown> | null =>
    artifact.payload && typeof artifact.payload === "object" ? artifact.payload : null,
  readDecisionActionArgs: (decision: any): Record<string, unknown> =>
    decision.action?.args && typeof decision.action.args === "object" ? decision.action.args : {},
  readString: (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null),
  hashPayloadShort: () => "hint-hash",
  mergeLedgerArtifacts: <T>(artifacts: T[]): T[] => artifacts,
  nowMs: () => 1234,
};

describe("Helix Ask runtime continuation hints extraction boundary", () => {
  it("keeps runtime-continuation hint implementation out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/runtime/runtime-continuation-hints");
    expect(routeSource).not.toMatch(/^const\s+buildHelixRuntimeContinuationHint\s*=/m);
    expect(routeSource).not.toMatch(/^const\s+appendHelixRuntimeContinuationHintsToPayload\s*=/m);
    expect(routeSource).not.toMatch(/^const\s+collectHelixRuntimeObservationRefsForHint\s*=/m);
    expect(routeSource).not.toMatch(/^const\s+collectHelixAgentStepDecisionsFromPayload\s*=/m);
    expect(routeSource).not.toMatch(/^const\s+helixRuntimeHintMatchesAgentStepDecision\s*=/m);
    expect(routeSource).not.toMatch(/^const\s+markHelixRuntimeContinuationHintsMigratedToAgentRuntimeLoop\s*=/m);
    expect(serviceSource).toMatch(/export\s+const\s+buildHelixRuntimeContinuationHint\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+appendHelixRuntimeContinuationHintsToPayload\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+collectHelixRuntimeObservationRefsForHint\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+markHelixRuntimeContinuationHintsMigratedToAgentRuntimeLoop\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("preserves hint construction and append side effects", () => {
    const hint = buildHelixRuntimeContinuationHint({
      turnId: "turn-1",
      source: "blocked_artifact_recovery",
      suggestedAction: {
        panel_id: "docs-viewer",
        action_id: "locate_in_doc",
        args: { path: "docs/example.md" },
      },
      missingArtifacts: [" doc_location_matches ", ""],
      reason: "needs location",
      migratedToAgentRuntimeLoop: false,
      dependencies,
    });

    expect(hint).toMatchObject({
      schema: "helix.runtime_continuation_hint.v1",
      hint_id: "turn-1:runtime_continuation_hint:hint-hash",
      suggested_capability: "docs-viewer.locate_in_doc",
      missing_artifacts: ["doc_location_matches"],
      authority: "hint_only_agent_must_decide",
      assistant_answer: false,
      raw_content_included: false,
    });

    const payload: Record<string, unknown> = {
      current_turn_artifact_ledger: [],
      debug: {},
    };
    appendHelixRuntimeContinuationHintsToPayload({
      payload,
      turnId: "turn-1",
      hints: [hint, hint],
      dependencies,
    });

    expect(payload.runtime_continuation_hints).toEqual([hint]);
    expect(payload.current_turn_artifact_ledger).toMatchObject([
      {
        artifact_id: "turn-1:runtime_continuation_hint:hint-hash",
        kind: "runtime_continuation_hint",
        created_at_ms: 1234,
        goal_hash: "hint-hash",
      },
    ]);
    expect((payload.debug as Record<string, unknown>).runtime_continuation_hints).toEqual([hint]);
  });

  it("preserves agent-step matching and migration side effects", () => {
    const hint = buildHelixRuntimeContinuationHint({
      turnId: "turn-1",
      source: "blocked_artifact_recovery",
      suggestedAction: {
        panel_id: "docs-viewer",
        action_id: "locate_in_doc",
        args: { path: "docs/example.md" },
      },
      missingArtifacts: ["doc_location_matches"],
      reason: "needs location",
      migratedToAgentRuntimeLoop: false,
      dependencies,
    });
    const decision = {
      schema: "helix.agent_step_decision.v1",
      decision_id: "decision-1",
      next_step: "next_action",
      decision: "execute",
      chosen_capability: "docs-viewer.locate_in_doc",
      action_authorization: {
        authorizes_tool_execution: true,
      },
      action: {
        panel_id: "docs-viewer",
        action_id: "locate_in_doc",
        args: { path: "docs/example.md" },
      },
    };
    const payload: Record<string, unknown> = {
      runtime_continuation_hints: [hint],
      current_turn_artifact_ledger: [
        {
          artifact_id: "decision-1",
          kind: "agent_step_decision",
          payload: decision,
        },
        {
          artifact_id: hint.hint_id,
          kind: "runtime_continuation_hint",
          payload: hint,
        },
      ],
      debug: {},
    };

    expect(collectHelixAgentStepDecisionsFromPayload(payload, dependencies)).toHaveLength(1);
    expect(helixRuntimeHintMatchesAgentStepDecision(hint, decision, dependencies)).toBe(true);

    markHelixRuntimeContinuationHintsMigratedToAgentRuntimeLoop({
      payload,
      turnId: "turn-1",
      dependencies,
    });

    expect(payload.runtime_continuation_hints).toMatchObject([
      {
        migrated_to_agent_runtime_loop: true,
        accepted_by_agent_step_decision: true,
        accepted_decision_ref: "decision-1",
        rejection_reason: null,
      },
    ]);
    expect((payload.debug as Record<string, unknown>).runtime_continuation_hints).toBe(payload.runtime_continuation_hints);
  });

  it("preserves observation refs matched to continuation hints", () => {
    const hint = buildHelixRuntimeContinuationHint({
      turnId: "turn-1",
      source: "blocked_artifact_recovery",
      suggestedAction: {
        panel_id: "docs-viewer",
        action_id: "locate_in_doc",
        args: { path: "docs/example.md" },
      },
      missingArtifacts: ["doc_location_matches"],
      reason: "needs location",
      dependencies,
    });

    expect(
      collectHelixRuntimeObservationRefsForHint({
        hint,
        artifacts: [
          {
            artifact_id: "match-1",
            kind: "doc_location_matches",
            payload: {
              path: "docs/example.md",
            },
          },
          {
            artifact_id: "miss-1",
            kind: "doc_location_matches",
            payload: {
              path: "docs/other.md",
            },
          },
        ],
        dependencies,
      }),
    ).toEqual({
      producedArtifacts: ["doc_location_matches"],
      observedArtifactRefs: ["match-1"],
    });
  });
});
