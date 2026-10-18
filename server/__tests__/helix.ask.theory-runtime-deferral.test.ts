import { describe, expect, it } from "vitest";

import { readWorkstationGatewayCallRequestsForTurn } from
  "../services/helix-ask/agent-providers/explicit-workstation-gateway";
import { HELIX_THEORY_CONTEXT_REFLECTION_CAPABILITY } from
  "../services/helix-ask/theory-congruence/capability-contract";

const readCapabilityId = (request: Record<string, unknown>): string | null =>
  typeof request.capability_id === "string"
    ? request.capability_id
    : typeof request.capabilityId === "string"
      ? request.capabilityId
      : null;

const theoryRequestsFor = (body: Record<string, unknown>): Record<string, unknown>[] =>
  readWorkstationGatewayCallRequestsForTurn({
    body,
    includePlannerDerived: true,
  }).filter((request) =>
    readCapabilityId(request) === HELIX_THEORY_CONTEXT_REFLECTION_CAPABILITY
  );

describe("runtime-owned theory reflection request admission", () => {
  it("defers a natural-language reflection with an explicit topic", () => {
    expect(theoryRequestsFor({
      agent_runtime: "codex",
      question:
        "Reflect deterministic microscopic laws producing probabilistic macroscopic observations with the Theory Badge Graph.",
    })).toEqual([]);
  });

  it("defers a deictic reflection instead of executing the graph with literal this", () => {
    expect(theoryRequestsFor({
      agent_runtime: "codex",
      question: "Reflect this with the Theory Badge Graph.",
      workspace_context_snapshot: {
        chat_referent_context: {
          previous_assistant_final_answer:
            "Deterministic microscopic laws can produce probabilistic macroscopic observations through coarse-graining.",
        },
      },
    })).toEqual([]);
  });

  it("defers a theory request synthesized from structured source-target admission", () => {
    expect(theoryRequestsFor({
      agent_runtime: "codex",
      question: "Compare determinism and probability across scales.",
      source_target_intent: {
        selected_capability: HELIX_THEORY_CONTEXT_REFLECTION_CAPABILITY,
        args: {
          query: "determinism and probability across scales",
        },
      },
    })).toEqual([]);
  });

  it("preserves an explicitly supplied, fully bound workstation gateway call", () => {
    const explicitCall = {
      schema: "helix.workstation_gateway.explicit_call_request.v1",
      capability_id: HELIX_THEORY_CONTEXT_REFLECTION_CAPABILITY,
      mode: "read",
      arguments: {
        prompt: "determinism and probability across scales",
        operation: "compare",
        build_explanation_plan: true,
      },
    };

    expect(theoryRequestsFor({
      agent_runtime: "codex",
      question: "Run the supplied reflection call.",
      workstation_gateway_call: explicitCall,
    })).toEqual([explicitCall]);
  });

  it.each([
    ["negated", "Do not reflect this with the Theory Badge Graph."],
    ["quoted", "The screen says: 'Reflect this with the Theory Badge Graph.'"],
    ["future", "Later, reflect this with the Theory Badge Graph."],
  ])("does not pre-execute a %s natural-language theory mention", (_label, question) => {
    expect(theoryRequestsFor({
      agent_runtime: "codex",
      question,
    })).toEqual([]);
  });
});
