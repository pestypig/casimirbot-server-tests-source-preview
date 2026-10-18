import { describe, expect, it } from "vitest";
import {
  HELIX_COMMITTED_ASK_ROUTE_SCHEMA,
  type HelixCommittedAskRoute,
} from "@shared/helix-committed-ask-route";
import {
  reconcileCanonicalGoalFrameToCommittedRoute,
  reconcileRouteProductContractToCommittedRoute,
} from "../committed-ask-route";

const scholarlyRoute = (turnId: string): HelixCommittedAskRoute => ({
  schema: HELIX_COMMITTED_ASK_ROUTE_SCHEMA,
  turn_id: turnId,
  commit_id: "committed-route:scholarly",
  prompt_hash: "prompt-hash",
  committed_at_stage: "post_prompt_source_arbitration",
  prompt_intent: {
    primary_intent_kind: "general_reasoning",
    secondary_intent_kinds: [],
  },
  route: {
    selected_route: "/ask",
    source_target: "scholarly_research",
    target_kind: "scholarly_research",
    strength: "hard",
    route_reason: "runtime_scholarly_capability_request",
    stale_metadata_policy: "ignore_unless_matches_commit",
  },
  canonical_goal: {
    goal_kind: "scholarly_research_lookup",
    required_terminal_kind: "scholarly_research_answer",
    allowed_terminal_artifact_kinds: ["scholarly_research_answer", "typed_failure"],
    forbidden_terminal_artifact_kinds: ["direct_answer_text"],
  },
  capability_policy: {
    allowed_tool_families: ["scholarly_research"],
    suppressed_tool_families: [],
    required_capability_families: ["scholarly_research"],
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
    followup_reasoning_required: true,
    required_terminal_product: "scholarly_research_answer",
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
});

describe("committed route canonical goal reconciliation", () => {
  it("replaces a stale model-only frame with the compatible scholarly route goal", () => {
    const turnId = "ask:test:magnetar-citations";
    const route = scholarlyRoute(turnId);
    route.compatibility.source_goal_capability_terminal_compatible = false;
    route.compatibility.violations = [
      "source_target_goal_mismatch:model_only_concept_for_source_backed_route",
      "required_terminal_product_forbidden",
    ];
    const result = reconcileCanonicalGoalFrameToCommittedRoute({
      turnId,
      canonicalGoalFrame: {
        turn_id: turnId,
        goal_kind: "model_only_concept",
        answer_scope: "model_only",
        required_terminal_kind: "direct_answer_text",
        allows_workspace_context: false,
        allows_prior_artifacts: false,
        confidence: "high",
        classifier_reasons: ["provider_preflight_scope_contract_model_only"],
      },
      committedRoute: route,
    });

    expect(result).toMatchObject({
      reconciled: true,
      reason: "committed_source_route_overrode_stale_model_only_goal",
      frame: {
        turn_id: turnId,
        goal_kind: "scholarly_research_lookup",
        answer_scope: "external_scholarly_research",
        required_terminal_kind: "scholarly_research_answer",
        allows_workspace_context: false,
        allows_prior_artifacts: false,
      },
    });
    expect(result.frame?.classifier_reasons).toEqual([
      "committed_source_route_overrode_stale_model_only_goal",
    ]);
    expect(result.frame?.concept_tokens).toEqual([]);
    expect(result.frame?.corpus_anchors).toEqual([]);
  });

  it("does not let an incompatible committed route override the canonical goal", () => {
    const turnId = "ask:test:incompatible-route";
    const route = scholarlyRoute(turnId);
    route.compatibility.source_goal_capability_terminal_compatible = false;
    route.compatibility.violations = ["required_capability_family_not_admitted"];
    const frame = {
      turn_id: turnId,
      goal_kind: "model_only_concept",
      required_terminal_kind: "direct_answer_text",
    };

    expect(reconcileCanonicalGoalFrameToCommittedRoute({
      turnId,
      canonicalGoalFrame: frame,
      committedRoute: route,
    })).toEqual({
      reconciled: false,
      frame,
      reason: null,
    });
  });

  it("does not replace a canonical frame with a malformed committed terminal kind", () => {
    const turnId = "ask:test:malformed-committed-terminal";
    const route = scholarlyRoute(turnId);
    (route.canonical_goal as { required_terminal_kind: unknown }).required_terminal_kind = {
      kind: "scholarly_research_answer",
    };
    const frame = {
      turn_id: turnId,
      goal_kind: "model_only_concept",
      required_terminal_kind: "direct_answer_text",
    };

    expect(reconcileCanonicalGoalFrameToCommittedRoute({
      turnId,
      canonicalGoalFrame: frame,
      committedRoute: route,
    })).toEqual({
      reconciled: false,
      frame,
      reason: null,
    });
  });

  it("does not replace a canonical frame when the committed terminal kind is missing", () => {
    const turnId = "ask:test:missing-committed-terminal";
    const route = scholarlyRoute(turnId);
    (route.canonical_goal as { required_terminal_kind: unknown }).required_terminal_kind = undefined;
    const frame = {
      turn_id: turnId,
      goal_kind: "model_only_concept",
      required_terminal_kind: "direct_answer_text",
    };

    expect(reconcileCanonicalGoalFrameToCommittedRoute({
      turnId,
      canonicalGoalFrame: frame,
      committedRoute: route,
    })).toEqual({ reconciled: false, frame, reason: null });
  });

  it("does not replace a route product contract with a malformed committed terminal kind", () => {
    const turnId = "ask:test:malformed-product-terminal";
    const route = scholarlyRoute(turnId);
    (route.canonical_goal as { required_terminal_kind: unknown }).required_terminal_kind = {
      kind: "scholarly_research_answer",
    };
    const contract = {
      schema: "helix.route_product_contract.v1",
      source_target: "model_only",
      goal_kind: "model_only_concept",
      required_terminal_kind: "direct_answer_text",
      allowed_terminal_artifact_kinds: ["direct_answer_text"],
    };

    expect(reconcileRouteProductContractToCommittedRoute({
      turnId,
      routeProductContract: contract,
      committedRoute: route,
    })).toEqual({
      reconciled: false,
      contract,
      reason: null,
    });
  });

  it("does not replace a route product contract when the committed terminal kind is missing", () => {
    const turnId = "ask:test:missing-product-terminal";
    const route = scholarlyRoute(turnId);
    (route.canonical_goal as { required_terminal_kind: unknown }).required_terminal_kind = undefined;
    const contract = {
      schema: "helix.route_product_contract.v1",
      source_target: "model_only",
      goal_kind: "model_only_concept",
      required_terminal_kind: "direct_answer_text",
      allowed_terminal_artifact_kinds: ["direct_answer_text"],
    };

    expect(reconcileRouteProductContractToCommittedRoute({
      turnId,
      routeProductContract: contract,
      committedRoute: route,
    })).toEqual({ reconciled: false, contract, reason: null });
  });

  it("does not override an intentional model-only demotion for a failure-only referent", () => {
    const turnId = "ask:test:failure-only-referent";
    const route = scholarlyRoute(turnId);
    const frame = {
      turn_id: turnId,
      goal_kind: "model_only_concept",
      answer_scope: "model_only",
      required_terminal_kind: "direct_answer_text",
      classifier_reasons: [
        "capability_contract_arbitration",
        "conversational_referent_no_evidence",
        "referent_cannot_supply_requested_evidence",
        "conversational_referent_has_no_retrievable_claims",
      ],
    };

    expect(reconcileCanonicalGoalFrameToCommittedRoute({
      turnId,
      canonicalGoalFrame: frame,
      committedRoute: route,
    })).toEqual({
      reconciled: false,
      frame,
      reason: null,
    });
  });

  it("preserves a situation-context goal specialized over a visual-capture source", () => {
    const turnId = "ask:test:visual-situation-context";
    const route = scholarlyRoute(turnId);
    route.route.source_target = "visual_capture";
    route.route.target_kind = "visual_capture";
    route.canonical_goal = {
      goal_kind: "visual_capture",
      required_terminal_kind: "situation_context_pack",
      allowed_terminal_artifact_kinds: ["situation_context_pack", "typed_failure"],
      forbidden_terminal_artifact_kinds: ["direct_answer_text"],
    };
    route.capability_policy.allowed_tool_families = ["situation_run"];
    route.capability_policy.required_capability_families = ["situation_run"];
    route.terminal_product.required_terminal_product = "situation_context_pack";
    const frame = {
      turn_id: turnId,
      goal_kind: "situation_context_question",
      answer_scope: "visual_capture",
      required_terminal_kind: "situation_context_pack",
      classifier_reasons: ["situation_context_question"],
    };

    expect(reconcileCanonicalGoalFrameToCommittedRoute({
      turnId,
      canonicalGoalFrame: frame,
      committedRoute: route,
    })).toEqual({
      reconciled: false,
      frame,
      reason: null,
    });
  });

  it("replaces a stale document frame and product contract with a compatible world route", () => {
    const turnId = "ask:test:world-route-stale-doc-lifecycle";
    const route = scholarlyRoute(turnId);
    route.route.source_target = "world_event";
    route.route.target_kind = "world_event";
    route.canonical_goal = {
      goal_kind: "environment_evidence_synthesis",
      required_terminal_kind: "model_synthesized_answer",
      allowed_terminal_artifact_kinds: [
        "model_synthesized_answer",
        "agent_provider_terminal_candidate",
        "typed_failure",
      ],
      forbidden_terminal_artifact_kinds: [],
    };
    route.capability_policy.allowed_tool_families = ["live_environment"];
    route.capability_policy.required_capability_families = [
      "live_environment",
    ];
    route.terminal_product.required_terminal_product =
      "model_synthesized_answer";

    const frameResult = reconcileCanonicalGoalFrameToCommittedRoute({
      turnId,
      canonicalGoalFrame: {
        turn_id: turnId,
        goal_kind: "doc_open_best",
        required_terminal_kind: "doc_open_receipt",
        classifier_reasons: ["doc_read_aloud_phrase"],
      },
      committedRoute: route,
    });
    const productResult = reconcileRouteProductContractToCommittedRoute({
      turnId,
      routeProductContract: {
        schema: "helix.route_product_contract.v1",
        source_target: "world_event",
        goal_kind: "doc_open_best",
        required_terminal_kind: "doc_open_receipt",
        allowed_terminal_artifact_kinds: ["doc_open_receipt"],
      },
      committedRoute: route,
    });

    expect(frameResult).toMatchObject({
      reconciled: true,
      reason: "committed_source_route_overrode_stale_incompatible_goal",
      frame: {
        goal_kind: "environment_evidence_synthesis",
        required_terminal_kind: "model_synthesized_answer",
        allowed_terminal_artifact_kinds: expect.arrayContaining([
          "model_synthesized_answer",
          "agent_provider_terminal_candidate",
        ]),
        source: "committed_route_canonical_goal_reconciliation",
      },
    });
    expect(productResult).toMatchObject({
      reconciled: true,
      reason: "committed_source_route_overrode_stale_product_contract",
      contract: {
        source_target: "world_event",
        goal_kind: "environment_evidence_synthesis",
        required_terminal_kind: "model_synthesized_answer",
        required_terminal_artifact_kind: "model_synthesized_answer",
        evidence_reentry_required: true,
        followup_reasoning_required: true,
      },
    });
  });

  it("does not carry an incompatible internet-search projection into a committed live-environment goal", () => {
    const turnId = "ask:test:live-environment-stale-internet-goal";
    const route = scholarlyRoute(turnId);
    route.route.source_target = "live_environment";
    route.route.target_kind = "live_environment";
    route.canonical_goal = {
      goal_kind: "environment_evidence_synthesis",
      required_terminal_kind: "model_synthesized_answer",
      allowed_terminal_artifact_kinds: [
        "model_synthesized_answer",
        "agent_provider_terminal_candidate",
        "typed_failure",
      ],
      forbidden_terminal_artifact_kinds: [],
    };
    route.capability_policy.allowed_tool_families = ["live_environment"];
    route.capability_policy.required_capability_families = [
      "live_environment",
    ];
    route.terminal_product.required_terminal_product =
      "model_synthesized_answer";

    const result = reconcileCanonicalGoalFrameToCommittedRoute({
      turnId,
      canonicalGoalFrame: {
        turn_id: turnId,
        goal_kind: "internet_search_lookup",
        answer_scope: "external_internet_search",
        required_terminal_kind: "internet_search_answer",
        corpus_anchors: ["web"],
        concept_tokens: [
          "internet_search",
          "search_action",
          "current_or_web_source",
        ],
        classifier_reasons: [
          "evidence_target_arbitration_selected_internet_search",
          "external_internet_search_source_target",
          "search_action",
          "current_or_web_source",
        ],
      },
      committedRoute: route,
    });

    expect(result).toMatchObject({
      reconciled: true,
      reason: "committed_source_route_overrode_stale_incompatible_goal",
      frame: {
        goal_kind: "environment_evidence_synthesis",
        answer_scope: "live_environment",
        required_terminal_kind: "model_synthesized_answer",
        corpus_anchors: [],
        concept_tokens: [],
        classifier_reasons: [
          "committed_source_route_overrode_stale_incompatible_goal",
        ],
      },
    });
  });
});
