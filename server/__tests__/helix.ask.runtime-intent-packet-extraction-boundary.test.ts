import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  appendHelixRuntimeIntentPacketToPayload,
  buildHelixRuntimeIntentPacket,
  isHelixRuntimeCapabilityTurn,
  isHelixRuntimeSourceTargetedTurn,
  refreshHelixRuntimeAuthorityAuditForIntentPacket,
} from "../services/helix-ask/runtime/runtime-intent-packet";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/runtime/runtime-intent-packet.ts");

const dependencies = {
  readString: (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null),
  resolveTerminalContract: () => ({
    goal_kind: "calculator_solve",
    required_actions: ["scientific-calculator.solve_expression"],
    required_evidence: ["calculator_receipt"],
    required_terminal_kinds: ["workstation_tool_evaluation"],
    forbidden_terminal_kinds: ["model_synthesized_answer"],
  }),
  hashPayloadShort: () => "intent-hash",
  mergeLedgerArtifacts: <T>(artifacts: T[]): T[] => artifacts,
  nowMs: () => 1234,
};

describe("Helix Ask runtime intent packet extraction boundary", () => {
  it("keeps the runtime-intent packet implementation out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/runtime/runtime-intent-packet");
    expect(routeSource).not.toMatch(/^const\s+buildHelixRuntimeIntentPacket\s*=/m);
    expect(routeSource).not.toMatch(/^const\s+appendHelixRuntimeIntentPacketToPayload\s*=/m);
    expect(routeSource).not.toMatch(/^const\s+refreshHelixRuntimeAuthorityAuditForIntentPacket\s*=/m);
    expect(serviceSource).toMatch(/export\s+const\s+buildHelixRuntimeIntentPacket\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+appendHelixRuntimeIntentPacketToPayload\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+refreshHelixRuntimeAuthorityAuditForIntentPacket\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("preserves source/capability turn predicates", () => {
    expect(
      isHelixRuntimeSourceTargetedTurn(
        {
          source_target_intent: {
            target_source: "repo_code",
          },
          canonical_goal_frame: {
            answer_scope: "model_only",
          },
        },
        dependencies,
      ),
    ).toBe(true);

    expect(
      isHelixRuntimeCapabilityTurn(
        {
          terminal_artifact_kind: "workstation_tool_evaluation",
        },
        dependencies,
      ),
    ).toBe(true);
  });

  it("preserves packet assembly and ledger/debug side effects", () => {
    const payload: Record<string, unknown> = {
      active_prompt: "Use the calculator.",
      route_reason_code: "calculator_route",
      canonical_goal_frame: {
        turn_id: "turn-1",
        goal_kind: "calculator_solve",
        answer_scope: "tool",
      },
      source_target_intent: {
        target_source: "calculator",
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "old:intent",
          kind: "runtime_intent_packet",
          payload: {},
        },
      ],
      debug: {},
    };

    const packet = buildHelixRuntimeIntentPacket({
      payload,
      turnId: "turn-1",
      dependencies,
    });
    expect(packet?.schema).toBe("helix.runtime_intent_packet.v1");
    expect(packet?.required_terminal_kinds).toEqual(["workstation_tool_evaluation"]);

    const appended = appendHelixRuntimeIntentPacketToPayload({
      payload,
      turnId: "turn-1",
      dependencies,
    });
    expect(appended?.completion_authority).toBe("agent_runtime_loop_and_goal_satisfaction");
    expect((payload.debug as Record<string, unknown>).runtime_intent_packet).toBe(appended);
    expect(payload.current_turn_artifact_ledger).toMatchObject([
      {
        artifact_id: "turn-1:runtime_intent_packet",
        kind: "runtime_intent_packet",
        created_at_ms: 1234,
        goal_hash: "intent-hash",
      },
    ]);
  });

  it("preserves audit refresh side effects", () => {
    const payload: Record<string, unknown> = {
      runtime_intent_packet: {
        schema: "helix.runtime_intent_packet.v1",
      },
      canonical_goal_frame: {
        answer_scope: "tool",
      },
      runtime_authority_audit: {
        checks: [
          {
            check: "runtime_intent_packet_present_for_source_or_capability_turn",
            passed: false,
            evidence: "",
          },
        ],
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "turn-1:runtime_authority_audit",
          kind: "runtime_authority_audit",
          payload: {},
        },
      ],
      debug: {},
    };

    refreshHelixRuntimeAuthorityAuditForIntentPacket({
      payload,
      turnId: "turn-1",
      dependencies,
    });

    expect(payload.runtime_authority_audit).toMatchObject({
      runtime_intent_packet_ref: "turn-1:runtime_intent_packet",
      source_targeted_turn: true,
      ok: true,
    });
    expect((payload.debug as Record<string, unknown>).runtime_authority_audit).toBe(payload.runtime_authority_audit);
    expect(payload.current_turn_artifact_ledger).toMatchObject([
      {
        payload: payload.runtime_authority_audit,
      },
    ]);
  });
});
