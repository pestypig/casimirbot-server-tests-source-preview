import { describe, expect, it } from "vitest";

import {
  appendHelixRuntimeIntentPacketToPayload,
  buildHelixRuntimeIntentPacket,
  buildHelixRuntimeSemanticRouteProposal,
  normalizeHelixRuntimeSemanticRouteProposal,
  type HelixRuntimeIntentPacketDependencies,
} from "../runtime-intent-packet";
import {
  assertCapabilityAllowedByCommittedRoute,
  buildRouteEvidenceAuthority,
} from "../../committed-ask-route";

const dependencies: HelixRuntimeIntentPacketDependencies = {
  readString: (value) => (typeof value === "string" && value.trim() ? value.trim() : null),
  resolveTerminalContract: () => ({
    required_actions: [],
    required_evidence: [],
    required_terminal_kinds: ["direct_answer_text"],
    forbidden_terminal_kinds: [],
  }),
  hashPayloadShort: (value) => JSON.stringify(value).length.toString(16).padStart(4, "0"),
  mergeLedgerArtifacts: (artifacts) => artifacts,
  nowMs: () => 1234,
};

describe("runtime semantic route proposal", () => {
  it("normalizes a bounded ordered compound capability set while preserving its primary capability", () => {
    const proposal = normalizeHelixRuntimeSemanticRouteProposal({
      value: {
        schema: "helix.runtime_semantic_route_proposal.v1",
        proposal_source: "agent_runtime",
        proposed_route: "compound_docs_calculator",
        proposed_tool_family: "compound",
        proposed_capability_id: "docs.search",
        proposed_capability_ids: [
          "docs.search",
          "scientific-calculator.solve_expression",
          "docs.search",
          "",
        ],
      },
      turnId: "ask:semantic-compound",
      promptHash: "prompt:semantic-compound",
      dependencies,
    });

    expect(proposal).toMatchObject({
      proposed_capability_id: "docs.search",
      proposed_capability_ids: [
        "docs.search",
        "scientific-calculator.solve_expression",
      ],
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("projects a non-terminal proposal from the runtime intent packet", () => {
    const packet = buildHelixRuntimeIntentPacket({
      payload: {
        canonical_goal_frame: {
          goal_kind: "model_only_concept",
          answer_scope: "model_only",
        },
      },
      turnId: "ask:semantic-proposal",
      prompt: "Explain a tool name without running it.",
      dependencies,
    });

    expect(packet).not.toBeNull();
    const proposal = buildHelixRuntimeSemanticRouteProposal({
      packet: packet!,
      dependencies,
    });

    expect(proposal).toMatchObject({
      schema: "helix.runtime_semantic_route_proposal.v1",
      turn_id: "ask:semantic-proposal",
      proposal_source: "runtime_intent_packet_projection",
      proposed_route: "model_only_concept",
      proposed_tool_family: "model_only",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(proposal.reason_summary).toContain("audit comparison only");
  });

  it("stores the proposal in current-turn ledger and route evidence debug without granting execution authority", () => {
    const payload: Record<string, unknown> = {
      turn_id: "ask:semantic-ledger",
      debug: {},
      canonical_goal_frame: {
        goal_kind: "calculator_solve",
        answer_scope: "workstation",
      },
      available_capabilities: {
        capabilities: [
          {
            capability_id: "scientific-calculator.solve_expression",
            goal_fit: "primary",
            requires_action: true,
          },
        ],
      },
      committed_ask_route: {
        schema: "helix.committed_ask_route.v1",
        turn_id: "ask:semantic-ledger",
        commit_id: "ask:semantic-ledger:committed_route",
        prompt_hash: "prompt-hash",
        committed_at_stage: "post_prompt_source_arbitration",
        prompt_intent: {
          primary_intent_kind: "calculator",
          secondary_intent_kinds: [],
        },
        route: {
          selected_route: "calculator_solve",
          source_target: "scientific_calculator",
          target_kind: "tool",
          strength: "hard",
          route_reason: "explicit calculator request",
          stale_metadata_policy: "ignore_unless_matches_commit",
        },
        canonical_goal: {
          goal_kind: "calculator_solve",
          required_terminal_kind: "workstation_tool_evaluation",
          allowed_terminal_artifact_kinds: ["workstation_tool_evaluation"],
          forbidden_terminal_artifact_kinds: [],
        },
        capability_policy: {
          allowed_tool_families: ["calculator"],
          suppressed_tool_families: [],
          required_capability_families: ["calculator"],
          mutating_families_allowed: false,
        },
        suppression: {
          contextual_tool_mentions: [],
          negative_constraints: [],
          suppressed_families: [],
          firewall_required: true,
        },
        terminal_product: {
          terminal_authority_required: true,
          evidence_reentry_required: true,
          followup_reasoning_required: false,
          required_terminal_product: "workstation_tool_evaluation",
        },
        transitions: [],
        compatibility: {
          source_goal_capability_terminal_compatible: true,
          stale_metadata_ignored: false,
          shortcut_firewall_applied: false,
          violations: [],
        },
        assistant_answer: false,
        raw_content_included: false,
      },
    };

    appendHelixRuntimeIntentPacketToPayload({
      payload,
      turnId: "ask:semantic-ledger",
      prompt: "Use the calculator to solve 8*9.",
      dependencies,
    });

    const proposal = payload.runtime_semantic_route_proposal as Record<string, unknown>;
    expect(proposal).toMatchObject({
      schema: "helix.runtime_semantic_route_proposal.v1",
      proposed_tool_family: "calculator",
      terminal_eligible: false,
      assistant_answer: false,
    });
    expect((payload.current_turn_artifact_ledger as Array<Record<string, unknown>>).map((artifact) => artifact.kind)).toEqual([
      "runtime_intent_packet",
      "runtime_semantic_route_proposal",
    ]);

    const authority = buildRouteEvidenceAuthority({
      committedRoute: null,
      payload,
    });

    expect(authority.route_proposal_authority).toMatchObject({
      semantic_route_proposal_source: "runtime_intent_packet_projection",
      runtime_semantic_route_proposal_ref: "ask:semantic-ledger:runtime_semantic_route_proposal",
      classifier_hints: "hint_only",
      prompt_derived_gateway_requests: "policy_admission_fallback",
      boundary: "runtime_decides_steps_helix_validates_admission",
    });
    expect(authority.route_proposal_authority.route_source_comparison).toMatchObject({
      codex_semantic_proposal_ref: null,
      final_admitted_route_ref: "ask:semantic-ledger:committed_route",
    });
    expect(authority.terminal_product_allowed).toBe(true);
    expect(proposal.terminal_eligible).toBe(false);
  });

  it("keeps a provider-authored proposal advisory when the committed route does not admit it", () => {
    const payload: Record<string, unknown> = {
      turn_id: "ask:agent-proposal",
      debug: {},
      canonical_goal_frame: {
        goal_kind: "model_only_concept",
        answer_scope: "model_only",
      },
      runtime_semantic_route_proposal: {
        schema: "helix.runtime_semantic_route_proposal.v1",
        turn_id: "ask:agent-proposal",
        proposal_source: "agent_runtime",
        proposed_route: "calculator_solve",
        proposed_tool_family: "calculator",
        proposed_capability_id: "scientific-calculator.solve_expression",
        confidence: "high",
        reason_summary: "Codex interpreted this as a no-tool conceptual answer.",
        terminal_eligible: true,
        assistant_answer: true,
        raw_content_included: true,
      },
      committed_ask_route: {
        schema: "helix.committed_ask_route.v1",
        turn_id: "ask:agent-proposal",
        commit_id: "ask:agent-proposal:committed_route",
        prompt_hash: "prompt-hash",
        committed_at_stage: "post_prompt_source_arbitration",
        prompt_intent: {
          primary_intent_kind: "content_question",
          secondary_intent_kinds: [],
        },
        route: {
          selected_route: "model_only_concept",
          source_target: "model_only",
          target_kind: "model",
          strength: "soft",
          route_reason: "provider semantic proposal admitted as model-only",
          stale_metadata_policy: "ignore_unless_matches_commit",
        },
        canonical_goal: {
          goal_kind: "model_only_concept",
          required_terminal_kind: "direct_answer_text",
          allowed_terminal_artifact_kinds: ["direct_answer_text"],
          forbidden_terminal_artifact_kinds: [],
        },
        capability_policy: {
          allowed_tool_families: ["model_only"],
          suppressed_tool_families: [],
          required_capability_families: [],
          mutating_families_allowed: false,
        },
        suppression: {
          contextual_tool_mentions: [],
          negative_constraints: [],
          suppressed_families: [],
          firewall_required: true,
        },
        terminal_product: {
          terminal_authority_required: true,
          evidence_reentry_required: false,
          followup_reasoning_required: true,
          required_terminal_product: "direct_answer_text",
        },
        transitions: [],
        compatibility: {
          source_goal_capability_terminal_compatible: true,
          stale_metadata_ignored: false,
          shortcut_firewall_applied: false,
          violations: [],
        },
        assistant_answer: false,
        raw_content_included: false,
      },
    };

    appendHelixRuntimeIntentPacketToPayload({
      payload,
      turnId: "ask:agent-proposal",
      prompt: "What is the Moral Graph reflection tool? Explain conceptually. Do not run it.",
      dependencies,
    });

    const proposal = payload.runtime_semantic_route_proposal as Record<string, unknown>;
    expect(proposal).toMatchObject({
      proposal_source: "agent_runtime",
      proposed_route: "calculator_solve",
      proposed_tool_family: "calculator",
      proposed_capability_id: "scientific-calculator.solve_expression",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });

    const authority = buildRouteEvidenceAuthority({
      committedRoute: null,
      payload,
    });

    expect(authority.route_proposal_authority).toMatchObject({
      semantic_route_proposal_source: "agent_runtime",
      runtime_semantic_route_proposal_ref: proposal.proposal_id,
    });
    expect(authority.route_proposal_authority.route_source_comparison).toMatchObject({
      codex_semantic_proposal_ref: proposal.proposal_id,
      final_admitted_route_ref: "ask:agent-proposal:committed_route",
    });
    expect(authority.terminal_product_allowed).toBe(true);

    const calculatorAdmission = assertCapabilityAllowedByCommittedRoute({
      committedRoute: payload.committed_ask_route as any,
      capabilityId: "scientific-calculator.solve_expression",
    });
    expect(calculatorAdmission).toMatchObject({
      allowed: false,
      reason: "selected_capability_not_allowed_by_committed_route",
    });
  });
});
