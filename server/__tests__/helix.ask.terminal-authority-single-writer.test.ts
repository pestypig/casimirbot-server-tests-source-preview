import crypto from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  agentContinuationRequiresNonterminalDecision,
  agentContinuationDisallowsAnswer,
  applyHelixTerminalAuthoritySingleWriter,
  applyTerminalProjectionKindGuard,
  shouldRefreshHelixTerminalAuthorityAfterSatisfiedGoal,
  syncDocEvidenceSynthesisSingleWriterFromTerminalAuthority,
  syncHelixTypedFailureAuthorityPublicMirrors,
} from "../services/helix-ask/terminal-authority-single-writer";
import { buildArtifactQueryIndex } from "../services/helix-ask/artifact-query-index";
import {
  inspectAgentProviderRouteProductEligibility,
  isProviderAuthoredRouteProductKind,
  materializeAgentProviderRouteProductTerminal,
} from "../services/helix-ask/terminal-product-materializers";
import { buildAskTurnSolverTrace } from "../services/helix-ask/ask-turn-solver";
import { buildCommittedAskRoute } from "../services/helix-ask/committed-ask-route";
import { buildTheoryExecutionClosureTerminalFixture } from "./fixtures/theory-execution-closure-terminal-fixture";
import { createHelixTurnLifecycleRecorder } from "../services/helix-ask/runtime/turn-lifecycle";

const makePostToolObservation = (turnId: string) => ({
  artifact_id: `${turnId}:obs`,
  kind: "agent_step_observation_packet",
  payload: {
    schema: "helix.agent_step_observation_packet.v1",
    turn_id: turnId,
    status: "succeeded",
    terminal_eligible: false,
    post_tool_model_step_required: true,
    action: "open",
    panel_id: "docs-viewer",
  },
});
describe("Helix terminal authority single writer", () => {
  it("keeps provider route products nonterminal while canonical continuation still requires an action", () => {
    const payload = {
      agent_continuation_state: {
        schema: "helix.agent_continuation_state.v1",
        goal: {
          status: "in_progress",
          satisfied: false,
          terminal_product_allowed: false,
        },
        allowed_decisions: ["act"],
      },
    };

    expect(agentContinuationRequiresNonterminalDecision(payload)).toBe(true);
    expect(agentContinuationDisallowsAnswer(payload)).toBe(true);
  });

  it("blocks deterministic compound drafting while authoritative continuation disallows answer", () => {
    expect(
      agentContinuationDisallowsAnswer({
        agent_continuation_state: {
          schema: "helix.agent_continuation_state.v1",
          goal: {
            status: "needs_user_input",
            satisfied: false,
            terminal_product_allowed: false,
          },
          allowed_decisions: ["ask_user", "fail"],
        },
      }),
    ).toBe(true);
    expect(
      agentContinuationDisallowsAnswer({
        agent_continuation_state: {
          schema: "helix.agent_continuation_state.v1",
          goal: {
            status: "satisfied",
            satisfied: true,
            terminal_product_allowed: true,
          },
          allowed_decisions: ["answer"],
        },
      }),
    ).toBe(false);
  });

  it("preserves an authorized provider user-input request over a stale downstream failure projection", () => {
    const turnId = "ask:test:provider-request-user-input";
    const observationRef = `${turnId}:workstation_gateway:player.look:blocked`;
    const candidateRef = `${turnId}:agent_provider_terminal_candidate:codex:blocked`;
    const requestText =
      "`request_canceled`: manual player input canceled the workflow. Please release the mouse and tell me when to try again.";
    const observation = {
      artifact_id: observationRef,
      kind: "provider_gateway_observation_packet",
      payload: {
        schema: "helix.agent_step_observation_packet.v1",
        turn_id: turnId,
        capability_key: "com.casimirbot.minecraft.player.look",
        status: "failed",
        missing_requirements: [
          {
            code: "request_canceled",
            message: "Release manual controls before retrying.",
            repair_action: "ask_user",
          },
        ],
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      },
    };
    const authority = {
      schema: "helix.turn_terminal_authority.v1",
      thread_id: "thread:test",
      turn_id: turnId,
      route: "/ask/turn",
      terminal_kind: "request_user_input",
      final_answer_source: "agent_provider_terminal_candidate",
      terminal_artifact_kind: "agent_provider_terminal_candidate",
      terminal_item_id: candidateRef,
      authority_origin: "request_user_input",
      server_authoritative: true,
      terminal_eligible: true,
      assistant_answer: false,
    };
    const presentation = {
      schema: "helix.terminal_presentation.v1",
      turn_id: turnId,
      concise_text: requestText,
      terminal_artifact_kind: "agent_provider_terminal_candidate",
      final_answer_source: "agent_provider_terminal_candidate",
      terminal_authority_ref: candidateRef,
      selected_observation_refs: [observationRef],
      assistant_answer: false,
      raw_content_included: false,
    };
    const candidate = {
      schema: "helix.agent_provider_terminal_candidate.v1",
      candidate_id: candidateRef,
      turn_id: turnId,
      terminal_intent: "request_user_input",
      candidate_text: requestText,
      grounded_in_observation_refs: [observationRef],
      normalized_observation_refs: [observationRef],
      evidence_reentry_required: true,
      provider_reasoning_completed: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    };
    const bridge = {
      schema: "helix.provider_terminal_authority_bridge.v1",
      turn_id: turnId,
      provider_terminal_candidate_ref: candidateRef,
      provider_terminal_intent: "request_user_input",
      request_user_input_boundary_observation_refs: [observationRef],
      normalized_observation_refs: [observationRef],
      normalized_observation_packet_count: 1,
      evidence_reentry_required: true,
      solver_completed: true,
      goal_satisfaction_compatible: true,
      route_authority_status: "provider_typed_user_input_boundary_satisfied",
      terminal_authority_status:
        "authorized_by_provider_request_user_input_bridge",
      terminal_authority_granted: true,
      final_visible_answer_authorized: true,
      terminal_answer_authority: authority,
      terminal_presentation: presentation,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    };
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      active_prompt:
        "Rotate my paired Minecraft player view and report the result.",
      current_turn_artifact_ledger: [observation],
      committed_ask_route: {
        schema: "helix.committed_ask_route.v1",
        turn_id: turnId,
        canonical_goal: {
          goal_kind: "agent_provider_gateway_turn",
          required_terminal_kind: "direct_answer_text",
          allowed_terminal_artifact_kinds: [
            "direct_answer_text",
            "request_user_input",
            "typed_failure",
          ],
          forbidden_terminal_artifact_kinds: [],
        },
        route: {
          selected_route: "/ask",
          source_target: "live_environment",
          target_kind: "live_environment",
          route_reason: "explicit_environment_action",
          strength: "hard",
        },
        capability_policy: {
          allowed_tool_families: ["live_environment"],
          suppressed_tool_families: [],
          required_capability_families: ["live_environment"],
          mutating_families_allowed: true,
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
          required_terminal_product: "direct_answer_text",
        },
        transitions: [],
        compatibility: {
          source_goal_capability_terminal_compatible: true,
          stale_metadata_ignored: false,
          shortcut_firewall_applied: false,
          violations: [],
        },
      },
      canonical_goal_frame: {
        schema: "helix.canonical_goal_frame.v1",
        turn_id: turnId,
        goal_kind: "agent_provider_gateway_turn",
        requested_capability: "com.casimirbot.minecraft.player.look",
        required_terminal_kind: "direct_answer_text",
        allowed_terminal_artifact_kinds: [
          "direct_answer_text",
          "request_user_input",
        ],
        forbidden_terminal_artifact_kinds: [],
        source: "codex_provider_workstation_gateway_projection",
      },
      provider_terminal_candidate: candidate,
      provider_reasoning_reentry: {
        schema: "helix.provider_reasoning_reentry.v1",
        turn_id: turnId,
        status: "completed",
        provider_terminal_intent: "request_user_input",
        request_user_input_boundary_observation_refs: [observationRef],
        evidence_reentered: true,
        observation_reentered: true,
        solver_completed: true,
        goal_satisfaction_compatible: true,
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      },
      provider_terminal_authority_bridge: bridge,
      terminal_answer_authority: authority,
      terminal_presentation: presentation,
      agent_continuation_state: {
        schema: "helix.agent_continuation_state.v1",
        turn_id: turnId,
        goal: {
          status: "needs_user_input",
          satisfied: false,
          terminal_product_allowed: false,
        },
        allowed_decisions: ["ask_user"],
      },
      typed_failure: {
        schema: "helix.typed_failure.v1",
        turn_id: turnId,
        error_code: "capability_unavailable",
        message: "The requested capability live_environment is not available.",
      },
      terminal_error_code: "capability_unavailable",
      selected_final_answer:
        "The requested capability live_environment is not available.",
      answer: "The requested capability live_environment is not available.",
      text: "The requested capability live_environment is not available.",
      route_authority_audit: { route_authority_ok: true },
      poison_audit: { ok: true },
    };

    const routeDisallowedPayload = structuredClone(payload);
    const disallowedCommittedGoal = (
      routeDisallowedPayload.committed_ask_route as {
        canonical_goal: { allowed_terminal_artifact_kinds: string[] };
      }
    ).canonical_goal;
    disallowedCommittedGoal.allowed_terminal_artifact_kinds =
      disallowedCommittedGoal.allowed_terminal_artifact_kinds.filter(
        (kind) => kind !== "request_user_input",
      );
    (
      disallowedCommittedGoal as typeof disallowedCommittedGoal & {
        forbidden_terminal_artifact_kinds: string[];
      }
    ).forbidden_terminal_artifact_kinds = ["request_user_input"];
    const disallowedCanonicalGoal =
      routeDisallowedPayload.canonical_goal_frame as {
        allowed_terminal_artifact_kinds: string[];
      };
    disallowedCanonicalGoal.allowed_terminal_artifact_kinds =
      disallowedCanonicalGoal.allowed_terminal_artifact_kinds.filter(
        (kind) => kind !== "request_user_input",
      );
    (
      disallowedCanonicalGoal as typeof disallowedCanonicalGoal & {
        forbidden_terminal_artifact_kinds: string[];
      }
    ).forbidden_terminal_artifact_kinds = ["request_user_input"];
    const disallowedResult = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload: routeDisallowedPayload,
      artifactLedger: [observation],
    });

    expect(disallowedResult).toMatchObject({
      selected_terminal_artifact_kind: "typed_failure",
      source: "typed_failure",
    });
    expect(routeDisallowedPayload).toMatchObject({
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
    });
    expect(routeDisallowedPayload.pending_server_request).toBeUndefined();
    expect(routeDisallowedPayload.pending_request).toBeUndefined();
    expect(routeDisallowedPayload.request_user_input).toBeUndefined();

    const continuationAllowedPayload = structuredClone(payload);
    const continuationAllowedCommittedGoal = (
      continuationAllowedPayload.committed_ask_route as {
        canonical_goal: { allowed_terminal_artifact_kinds: string[] };
      }
    ).canonical_goal;
    continuationAllowedCommittedGoal.allowed_terminal_artifact_kinds =
      continuationAllowedCommittedGoal.allowed_terminal_artifact_kinds.filter(
        (kind) => kind !== "request_user_input",
      );
    const continuationAllowedCanonicalGoal =
      continuationAllowedPayload.canonical_goal_frame as {
        allowed_terminal_artifact_kinds: string[];
      };
    continuationAllowedCanonicalGoal.allowed_terminal_artifact_kinds =
      continuationAllowedCanonicalGoal.allowed_terminal_artifact_kinds.filter(
        (kind) => kind !== "request_user_input",
      );
    const continuationAllowedResult = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload: continuationAllowedPayload,
      artifactLedger: [observation],
    });

    expect(continuationAllowedResult).toMatchObject({
      selected_terminal_artifact_kind: "request_user_input",
      source: "request_user_input",
      visible_text: requestText,
    });
    expect(continuationAllowedPayload).toMatchObject({
      response_type: "pending_input",
      terminal_artifact_kind: "request_user_input",
      final_answer_source: "request_user_input",
    });

    expect(
      inspectAgentProviderRouteProductEligibility({
        payload,
        artifacts: [observation],
        turnId,
        requiredTerminalKind: "direct_answer_text",
        routeAllowsTerminalKind: (kind) => kind === "direct_answer_text",
      }),
    ).toMatchObject({
      authority_shape_valid: true,
      current_turn_support_ref_count: 1,
      rejection_reason: null,
    });

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: [observation],
    });

    expect(result).toMatchObject({
      selected_terminal_artifact_kind: "request_user_input",
      source: "request_user_input",
      visible_text: requestText,
    });
    expect(payload).toMatchObject({
      ok: true,
      response_type: "pending_input",
      final_status: "pending_input",
      terminal_artifact_kind: "request_user_input",
      final_answer_source: "request_user_input",
      assistant_answer: false,
      pending_server_request: expect.objectContaining({
        request_kind: "request_user_input",
        prompt: requestText,
      }),
      terminal_answer_authority: expect.objectContaining({
        terminal_kind: "request_user_input",
        terminal_artifact_kind: "request_user_input",
      }),
    });
    expect(payload.selected_terminal_support_refs).toEqual([observationRef]);
    expect(payload.terminal_synthesis_support_refs).toEqual([observationRef]);
    expect(payload.typed_failure).toBeUndefined();
  });

  it("admits model-synthesized SituationRun context as a provider-authored route product", () => {
    expect(isProviderAuthoredRouteProductKind("situation_context_pack")).toBe(true);
  });

  it("selects a Postulate runtime review candidate through terminal authority", () => {
    const turnId = "ask:test:postulate-runtime-review";
    const answerText = "Postulate review: submit at 91%.\nSubmitted: yes.\nBoundary: accepted means constructive review candidate, not proof, physical viability, or certification.";
    const reviewArtifact = {
      artifact_id: `${turnId}:postulate_runtime_review`,
      kind: "postulate_runtime_review",
      payload: {
        schema: "helix.postulate_runtime_review.v1",
        artifact_id: `${turnId}:postulate_runtime_review`,
        turn_id: turnId,
        text: answerText,
        answer_text: answerText,
        terminal_result: {
          schema: "helix.ask.postulate_review_result.v1",
          runtimeReview: {
            readinessRating: 91,
            decision: "submit",
          },
          submissionGate: {
            shouldSubmit: true,
            reasons: [],
          },
        },
        assistant_answer: false,
        terminal_eligible: true,
        raw_content_included: false,
      },
    };
    const artifacts = [reviewArtifact];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      ok: true,
      response_type: "final_answer",
      final_status: "completed",
      postulate_runtime_review: reviewArtifact.payload,
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        required_terminal_kind: "postulate_runtime_review",
        required_terminal_artifact_kind: "postulate_runtime_review",
        allowed_terminal_artifact_kinds: ["postulate_runtime_review", "typed_failure"],
      },
      canonical_goal_frame: {
        schema: "helix.canonical_goal_frame.v1",
        goal_kind: "postulate_runtime_review",
        required_terminal_kind: "postulate_runtime_review",
      },
      current_turn_artifact_ledger: artifacts,
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("postulate_runtime_review");
    expect(result.source).toBe("postulate_runtime_review");
    expect(result.visible_text).toBe(answerText);
    expect(payload.terminal_artifact_kind).toBe("postulate_runtime_review");
    expect(payload.final_answer_source).toBe("postulate_runtime_review");
    expect(payload.selected_final_answer).toBe(answerText);
    expect(payload.terminal_error_code).toBeUndefined();
  });

  it("allows a bounded Image Lens observation report after visual receipt re-entry", () => {
    const turnId = "ask:test:image-lens-observation-report";
    const observationRef = `${turnId}:capability_lane:visual_analysis.inspect_image_region:obs`;
    const answerText = [
      "The runtime provider echoed Helix internal capability instructions after Image Lens observations re-entered, so I am using only the observation receipts below and not the echoed provider text.",
      "",
      "**crop_1**",
      "- Bbox: x=73, y=570, width=1077, height=87",
      "- Extraction status: extracted",
      "- Exact equation admissibility: admissible_for_exact_equation",
      "- Exact row promotion: promoted; reasons: requested_label_matched, single_clean_row, extracted_latex_candidate_present",
    ].join("\n");
    const artifacts = [
      {
        artifact_id: observationRef,
        kind: "agent_step_observation_packet",
        payload: {
          schema: "helix.agent_step_observation_packet.v1",
          turn_id: turnId,
          status: "succeeded",
          terminal_eligible: false,
          post_tool_model_step_required: true,
          action: "inspect_image_region",
          panel_id: "image_lens",
          capability_key: "visual_analysis.inspect_image_region",
          assistant_answer: false,
          raw_content_included: false,
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      ok: true,
      response_type: "final_answer",
      final_status: "completed",
      selected_final_answer: answerText,
      answer: answerText,
      text: answerText,
      final_answer_source: "provider_image_lens_observation_report",
      terminal_artifact_kind: "image_lens_observation_report",
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        required_terminal_artifact_kind: "image_lens_observation_report",
        required_terminal_kind: "image_lens_observation_report",
        allowed_terminal_artifact_kinds: ["image_lens_observation_report", "typed_failure"],
      },
      canonical_goal_frame: {
        schema: "helix.canonical_goal_frame.v1",
        goal_kind: "agent_provider_gateway_turn",
        required_terminal_kind: "image_lens_observation_report",
      },
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        thread_id: "thread:test",
        turn_id: turnId,
        terminal_kind: "answer",
        final_answer_source: "provider_image_lens_observation_report",
        terminal_artifact_kind: "image_lens_observation_report",
        terminal_item_id: `${turnId}:image_lens_observation_report`,
        terminal_text_preview: answerText,
        server_authoritative: true,
        terminal_eligible: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        turn_id: turnId,
        terminal_artifact_kind: "image_lens_observation_report",
        concise_text: answerText,
        assistant_answer: false,
        raw_content_included: false,
      },
      current_turn_artifact_ledger: artifacts,
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("image_lens_observation_report");
    expect(result.source).toBe("provider_image_lens_observation_report");
    expect(result.visible_text).toBe(answerText);
    expect(payload.terminal_artifact_kind).toBe("image_lens_observation_report");
    expect(payload.final_answer_source).toBe("provider_image_lens_observation_report");
    expect(payload.terminal_error_code).toBeUndefined();
    expect(String(payload.selected_final_answer)).not.toContain("post-tool model step");
  });

  it("materializes an Image Lens observation report from the current turn ledger before post-tool failure", () => {
    const turnId = "ask:test:image-lens-ledger-materialized";
    const observationRef = `${turnId}:capability_lane:visual_analysis.inspect_image_region:obs`;
    const receipt = {
      capability: "visual_analysis.inspect_image_region",
      region_label: "equation_7",
      bbox_px: { x: 73, y: 570, width: 1077, height: 87 },
      crop_ref: "sha256:test#crop=73,570,1077,87",
      extraction_status: "extracted",
      label_match_status: "matched",
      exact_equation_admissibility: "admissible_for_exact_equation",
      exact_row_promotion: {
        status: "promoted",
        reasons: ["requested_label_matched", "single_clean_row", "extracted_latex_candidate_present"],
      },
      text_candidate:
        "S = \\int d^{4}x \\sqrt{-g} e^{-\\phi} \\{ R + 2\\Lambda e^{-\\phi} + \\kappa e^{-\\phi} L_{m} \\}, (7)",
      latex_candidate:
        "S = \\int d^{4}x \\sqrt{-g} e^{-\\phi} \\{ R + 2\\Lambda e^{-\\phi} + \\kappa e^{-\\phi} L_{m} \\}, \\quad (7)",
    };
    const artifacts = [
      {
        artifact_id: observationRef,
        kind: "capability_lane_observation_packet",
        payload: {
          schema: "helix.agent_step_observation_packet.v1",
          turn_id: turnId,
          status: "succeeded",
          terminal_eligible: false,
          post_tool_model_step_required: true,
          capability_key: "visual_analysis.inspect_image_region",
          receipt,
          assistant_answer: false,
          raw_content_included: false,
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      ok: true,
      response_type: "final_answer",
      final_status: "completed",
      terminal_artifact_kind: "agent_provider_terminal_candidate",
      final_answer_source: "agent_provider_terminal_candidate",
      solver_continuation_observation: {
        schema: "helix.solver_continuation_observation.v1",
        required_next_step: "finalize",
      },
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        required_terminal_artifact_kind: "image_lens_observation_report",
        allowed_terminal_artifact_kinds: ["image_lens_observation_report", "typed_failure"],
      },
      canonical_goal_frame: {
        schema: "helix.canonical_goal_frame.v1",
        goal_kind: "image_lens_region_inspection",
        required_terminal_kind: "image_lens_observation_report",
      },
      debug: {
        capability_lane_call_results: [
          {
            capability: "visual_analysis.inspect_image_region",
            ok: true,
            receipt,
          },
        ],
      },
      current_turn_artifact_ledger: artifacts,
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("image_lens_observation_report");
    expect(result.source).toBe("provider_image_lens_observation_report");
    expect(result.visible_text).toContain("**equation_7**");
    expect(result.visible_text).toContain("admissible_for_exact_equation");
    expect(result.visible_text).toContain("```latex");
    expect(payload.terminal_artifact_kind).toBe("image_lens_observation_report");
    expect(payload.final_answer_source).toBe("provider_image_lens_observation_report");
    expect(payload.terminal_error_code).toBeUndefined();
    expect(String(payload.selected_final_answer)).not.toContain("post-tool model step");
  });

  it("keeps Image Lens observation packets ambient when the route does not admit image reports", () => {
    const turnId = "ask:test:image-lens-ambient-not-terminal";
    const answerText = "A direct conceptual answer should remain the terminal answer.";
    const imageObservationRef = `${turnId}:capability_lane:visual_analysis.inspect_image_region:obs`;
    const directAnswerRef = `${turnId}:direct_answer_text`;
    const receipt = {
      capability: "visual_analysis.inspect_image_region",
      region_label: "equation_7",
      bbox_px: { x: 73, y: 570, width: 1077, height: 87 },
      crop_ref: "sha256:test#crop=73,570,1077,87",
      extraction_status: "extracted",
      exact_equation_admissibility: "admissible_for_exact_equation",
      latex_candidate:
        "S = \\int d^{4}x \\sqrt{-g} e^{-\\phi} \\{ R + 2\\Lambda e^{-\\phi} + \\kappa e^{-\\phi} L_{m} \\}, \\quad (7)",
    };
    const artifacts = [
      {
        artifact_id: imageObservationRef,
        kind: "capability_lane_observation_packet",
        payload: {
          schema: "helix.agent_step_observation_packet.v1",
          turn_id: turnId,
          status: "succeeded",
          capability_key: "visual_analysis.inspect_image_region",
          receipt,
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        },
      },
      {
        artifact_id: directAnswerRef,
        kind: "direct_answer_text",
        payload: {
          schema: "helix.direct_answer_text.v1",
          artifact_id: directAnswerRef,
          text: answerText,
          answer_text: answerText,
          terminal_eligible: true,
          assistant_answer: false,
          raw_content_included: false,
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      ok: true,
      response_type: "final_answer",
      final_status: "completed",
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        required_terminal_kind: "direct_answer_text",
        allowed_terminal_artifact_kinds: ["direct_answer_text", "typed_failure"],
      },
      committed_ask_route: {
        schema: "helix.committed_ask_route.v1",
        turn_id: turnId,
        commit_id: "commit:test",
        prompt_hash: "hash:test",
        committed_at_stage: "post_prompt_source_arbitration",
        prompt_intent: {
          primary_intent_kind: "content_question",
          secondary_intent_kinds: [],
        },
        route: {
          selected_route: "model_only_concept",
          source_target: "model_only",
          target_kind: "general_background",
          strength: "hard",
          route_reason: "image_lens_observation_is_ambient",
          stale_metadata_policy: "ignore_unless_matches_commit",
        },
        canonical_goal: {
          goal_kind: "model_only_concept",
          required_terminal_kind: "direct_answer_text",
          allowed_terminal_artifact_kinds: ["direct_answer_text", "typed_failure"],
        },
        assistant_answer: false,
        raw_content_included: false,
      },
      current_turn_artifact_ledger: artifacts,
      canonical_goal_frame: {
        goal_kind: "model_only_concept",
        answer_scope: "model_only",
        required_terminal_kind: "direct_answer_text",
      },
      goal_satisfaction_evaluation: {
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
        terminal_contract: {
          goal_kind: "model_only_concept",
          required_terminal_kinds: ["direct_answer_text"],
        },
      },
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("direct_answer_text");
    expect(result.source).toBe("direct_answer_text");
    expect(result.visible_text).toBe(answerText);
    expect(payload.terminal_artifact_kind).toBe("direct_answer_text");
    expect(payload.final_answer_source).not.toBe("provider_image_lens_observation_report");
    expect(payload.selected_final_answer).toBe(answerText);
  });

  it("blocks terminal selection while the runtime agent still owes an admitted continuation action", () => {
    const turnId = "ask:test:agent-continuation-action-pending";
    const directAnswerRef = `${turnId}:direct_answer_text`;
    const artifacts = [{
      artifact_id: directAnswerRef,
      kind: "direct_answer_text",
      payload: {
        schema: "helix.direct_answer_text.v1",
        artifact_id: directAnswerRef,
        text: "A premature bounded answer.",
        answer_text: "A premature bounded answer.",
        terminal_eligible: true,
        assistant_answer: false,
        raw_content_included: false,
      },
    }];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      response_type: "final_answer",
      final_status: "completed",
      selected_final_answer: "A premature bounded answer.",
      terminal_artifact_kind: "direct_answer_text",
      final_answer_source: "direct_answer_text",
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        required_terminal_kind: "direct_answer_text",
        allowed_terminal_artifact_kinds: ["direct_answer_text", "typed_failure"],
      },
      canonical_goal_frame: {
        schema: "helix.canonical_goal_frame.v1",
        goal_kind: "model_only_concept",
        required_terminal_kind: "direct_answer_text",
      },
      agent_continuation_state: {
        schema: "helix.agent_continuation_state.v1",
        state_id: `${turnId}:agent_continuation_state:2`,
        allowed_decisions: ["act", "retry"],
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      current_turn_artifact_ledger: artifacts,
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("typed_failure");
    expect(payload.terminal_error_code).toBe("solver_continuation_pending");
    expect(String(payload.selected_final_answer)).toContain("solver continuation is required");
    expect(result.rejected_candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: "solver_continuation_pending" }),
    ]));
  });

  it("does not project stale answer prose through a newly selected typed failure", () => {
    const turnId = "ask:test:agent-continuation-stale-failure-projection";
    const staleAnswer = "The observed search found two relevant magnetar reviews.";
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      ok: false,
      response_type: "final_failure",
      final_status: "final_failure",
      selected_final_answer: staleAnswer,
      answer: staleAnswer,
      text: staleAnswer,
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
      agent_continuation_state: {
        schema: "helix.agent_continuation_state.v1",
        state_id: `${turnId}:agent_continuation_state:2`,
        allowed_decisions: ["act", "retry"],
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      current_turn_artifact_ledger: [],
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: [],
    });

    expect(result.selected_terminal_artifact_kind).toBe("typed_failure");
    expect(result.visible_text).toContain("solver continuation is required");
    expect(result.visible_text).not.toBe(staleAnswer);
    expect(result.writes).toMatchObject({
      payload_text: result.visible_text,
      payload_answer: result.visible_text,
      payload_selected_final_answer: result.visible_text,
      terminal_presentation_concise_text: result.visible_text,
      debug_selected_final_answer: result.visible_text,
    });
    expect(payload.selected_final_answer).toBe(result.visible_text);
    expect((payload.terminal_presentation as Record<string, unknown>).concise_text)
      .toBe(result.visible_text);
  });

  it("surfaces an authorized provider terminal candidate after Moral Graph observation re-entry", () => {
    const turnId = "ask:test:moral-graph-provider-terminal";
    const observationRef = `${turnId}:codex_normalized:moral_graph_reflection:1`;
    const staleImageRef = `${turnId}:prior_scientific_image_sidecar`;
    const staleScholarlyRef = `${turnId}:prior_scholarly_lookup`;
    const answerText =
      "The Moral Graph frames delayed disclosure as a dependency-transparency problem that should preserve agency before options close.";
    const artifacts = [
      {
        artifact_id: observationRef,
        kind: "moral_graph_reflection",
        payload: {
          schema: "helix.moral_graph_reflection_observation.v1",
          turn_id: turnId,
          capability_key: "moral-graph.reflect_context",
          status: "succeeded",
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
      },
      {
        artifact_id: staleImageRef,
        kind: "scientific_image_evidence_sidecar",
        source_scope: "prior_context",
        payload: {
          schema: "helix.scientific_image_evidence_sidecar.v1",
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
      },
      {
        artifact_id: staleScholarlyRef,
        kind: "scholarly_research_observation",
        source_scope: "prior_context",
        payload: {
          schema: "helix.scholarly_research_observation.v1",
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      response_type: "final_answer",
      final_status: "completed",
      text: answerText,
      answer: answerText,
      selected_final_answer: answerText,
      final_answer_source: "agent_provider_terminal_candidate",
      terminal_artifact_kind: "agent_provider_terminal_candidate",
      solver_continuation_observation: {
        schema: "helix.solver_continuation_observation.v1",
        required_next_step: "model.direct_answer",
      },
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        source_target: "agent_provider_gateway_turn",
        required_terminal_artifact_kind: "agent_provider_terminal_candidate",
        allowed_terminal_artifact_kinds: ["agent_provider_terminal_candidate", "typed_failure"],
        assistant_answer: false,
        raw_content_included: false,
      },
      canonical_goal_frame: {
        schema: "helix.canonical_goal_frame.v1",
        goal_kind: "agent_provider_gateway_turn",
        requested_capability: "moral-graph.reflect_context",
        required_terminal_kind: "agent_provider_terminal_candidate",
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        thread_id: "thread:test",
        turn_id: turnId,
        route: "/ask/turn",
        terminal_kind: "answer",
        final_answer_source: "agent_provider_terminal_candidate",
        terminal_artifact_kind: "agent_provider_terminal_candidate",
        terminal_item_id: `${turnId}:agent_provider_terminal_candidate:codex:abc123`,
        terminal_text_preview: answerText,
        server_authoritative: true,
        terminal_eligible: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        turn_id: turnId,
        concise_text: answerText,
        terminal_artifact_kind: "agent_provider_terminal_candidate",
        final_answer_source: "agent_provider_terminal_candidate",
        terminal_authority_ref: `${turnId}:agent_provider_terminal_candidate:codex:abc123`,
        selected_observation_refs: [observationRef, staleImageRef],
        assistant_answer: false,
        raw_content_included: false,
      },
      debug: {
        provider_terminal_candidate: {
          schema: "helix.agent_provider_terminal_candidate.v1",
          candidate_id: `${turnId}:agent_provider_terminal_candidate:codex:abc123`,
          candidate_text_preview: answerText,
          grounded_in_observation_refs: [observationRef, staleImageRef, staleScholarlyRef],
          normalized_observation_refs: [observationRef, staleImageRef],
          evidence_reentry_required: true,
          provider_reasoning_completed: true,
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
      },
      current_turn_artifact_ledger: artifacts,
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("agent_provider_terminal_candidate");
    expect(result.source).toBe("agent_provider_terminal_candidate");
    expect(result.visible_text).toBe(answerText);
    expect(payload.final_answer_source).toBe("agent_provider_terminal_candidate");
    expect(payload.terminal_artifact_kind).toBe("agent_provider_terminal_candidate");
    expect(payload.terminal_error_code).toBeUndefined();
    expect(result.rejected_candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "typed_failure",
        reason: "stale_solver_continuation_superseded_by_provider_terminal",
      }),
    ]));
    expect(payload.selected_terminal_support_refs).toEqual([observationRef]);
    expect(payload.terminal_synthesis_support_refs).toEqual([observationRef]);
    expect((payload.terminal_presentation as Record<string, unknown>).selected_observation_refs).toEqual([
      observationRef,
    ]);
    expect((payload.terminal_presentation as Record<string, unknown>).support_refs).toEqual([observationRef]);
    expect((payload.terminal_presentation as Record<string, unknown>).rejected_support_refs).toEqual([
      staleImageRef,
      staleScholarlyRef,
    ]);
    expect((payload.terminal_presentation as Record<string, unknown>).support_ref_filter).toBe("moral_graph_reflection_only");
    expect(payload.ask_turn_procedure_trace).toMatchObject({
      schema: "helix.ask_turn_procedure_trace.v1",
      intent_class: "agent_provider_gateway_turn",
      evidence_reentry_status: "reentered",
      allowed_terminal_products: expect.arrayContaining(["agent_provider_terminal_candidate"]),
      selected_terminal_product: expect.objectContaining({
        kind: "agent_provider_terminal_candidate",
        allowed_by_route: true,
      }),
      visible_answer_source: "agent_provider_terminal_candidate",
      failure_rail: null,
    });
  });

  it("materializes a grounded provider candidate as the route-required Docs synthesis product", () => {
    const turnId = "ask:test:docs-provider-route-product";
    const observationRefs = [
      `${turnId}:workstation_gateway:docs.search:1`,
      `${turnId}:workstation_gateway:docs.search:2`,
    ];
    const answerText = [
      "The current whitepaper identifies three unresolved blockers.",
      "1. Closure residual: the diagnostic is established, while closure remains proposed.",
      "2. Source reconstruction: the document reports a proxy, not a validated stress-energy source.",
      "3. Runtime validation: benchmark routes exist, but certification remains unproven.",
    ].join("\n");
    const artifacts = observationRefs.map((artifactId) => ({
      artifact_id: artifactId,
      kind: "provider_gateway_observation_packet",
      payload: {
        schema: "helix.agent_step_observation_packet.v1",
        turn_id: turnId,
        capability_key: "docs.search",
        status: "succeeded",
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      },
    }));
    const providerCandidateRef = `${turnId}:agent_provider_terminal_candidate:codex:docs`;
    const lifecycleRecorder = createHelixTurnLifecycleRecorder({
      turnId,
      scope: "helix_ask_turn",
      now: () => 100,
    });
    let lifecyclePrior = lifecycleRecorder.append({
      kind: "turn.started",
      producer: "helix_adapter",
      status: "started",
    });
    const lifecycleRoute = lifecycleRecorder.append({
      kind: "route.committed",
      producer: "helix_policy",
      status: "succeeded",
      causation_id: lifecyclePrior.event_id,
      route_commit_id: `${turnId}:route`,
      capability_ids: ["docs.search"],
    });
    lifecyclePrior = lifecycleRecorder.append({
      kind: "capability.admitted",
      producer: "helix_policy",
      status: "succeeded",
      causation_id: lifecycleRoute.event_id,
      route_commit_id: `${turnId}:route`,
      capability_id: "docs.search",
    });
    for (const [index, observationRef] of observationRefs.entries()) {
      const call = lifecycleRecorder.append({
        kind: "tool.call.started",
        producer: "codex_runtime",
        status: "started",
        causation_id: lifecyclePrior.event_id,
        route_commit_id: `${turnId}:route`,
        call_id: `${turnId}:docs:${index + 1}`,
        capability_id: "docs.search",
      });
      const completed = lifecycleRecorder.append({
        kind: "tool.call.completed",
        producer: "helix_adapter",
        status: "succeeded",
        causation_id: call.event_id,
        route_commit_id: `${turnId}:route`,
        call_id: `${turnId}:docs:${index + 1}`,
        capability_id: "docs.search",
        observation_refs: [observationRef],
      });
      lifecyclePrior = lifecycleRecorder.append({
        kind: "observation.reentered",
        producer: "helix_adapter",
        status: "succeeded",
        causation_id: completed.event_id,
        route_commit_id: `${turnId}:route`,
        call_id: `${turnId}:docs:${index + 1}`,
        capability_id: "docs.search",
        observation_refs: [observationRef],
      });
    }
    const lifecycleMessage = lifecycleRecorder.append({
      kind: "agent.message.completed",
      producer: "codex_runtime",
      status: "succeeded",
      causation_id: lifecyclePrior.event_id,
      message_sha256: crypto
        .createHash("sha256")
        .update(answerText)
        .digest("hex"),
    });
    lifecycleRecorder.append({
      kind: "runtime.turn.completed",
      producer: "codex_runtime",
      status: "succeeded",
      causation_id: lifecycleMessage.event_id,
    });
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      turn_lifecycle: lifecycleRecorder.snapshot(),
      current_turn_artifact_ledger: artifacts,
      committed_ask_route: {
        schema: "helix.committed_ask_route.v1",
        turn_id: turnId,
        prompt_hash: "hash:docs-provider-route-product",
        canonical_goal: {
          goal_kind: "docs",
          required_terminal_kind: "model_synthesized_answer",
          allowed_terminal_artifact_kinds: ["model_synthesized_answer", "typed_failure"],
          forbidden_terminal_artifact_kinds: [],
        },
        route: {
          selected_route: "/ask",
          source_target: "docs_viewer",
          target_kind: "docs_viewer",
          route_reason: "explicit_docs_path",
          strength: "hard",
        },
        capability_policy: {
          allowed_tool_families: ["docs_viewer"],
          suppressed_tool_families: [],
          required_capability_families: ["docs_viewer"],
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
          required_terminal_product: "model_synthesized_answer",
        },
        transitions: [],
        compatibility: {
          source_goal_capability_terminal_compatible: true,
          stale_metadata_ignored: false,
          shortcut_firewall_applied: false,
          violations: [],
        },
      },
      canonical_goal_frame: {
        goal_kind: "docs",
        required_terminal_kind: "model_synthesized_answer",
      },
      route_evidence_authority: {
        schema: "helix.route_evidence_authority.v1",
        turn_id: turnId,
        terminal_product_allowed: true,
        // A legacy/advisory mirror can be stale. It must never override the
        // concrete committed Docs route or canonical goal frame below.
        required_terminal_kind: "unknown",
        allowed_terminal_artifact_kinds: ["model_synthesized_answer", "typed_failure"],
        forbidden_terminal_artifact_kinds: [],
      },
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        thread_id: "thread:test",
        turn_id: turnId,
        route: "/ask",
        terminal_kind: "answer",
        final_answer_source: "agent_provider_terminal_candidate",
        terminal_artifact_kind: "agent_provider_terminal_candidate",
        terminal_item_id: providerCandidateRef,
        server_authoritative: true,
        terminal_eligible: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        turn_id: turnId,
        concise_text: answerText,
        terminal_artifact_kind: "agent_provider_terminal_candidate",
        final_answer_source: "agent_provider_terminal_candidate",
        terminal_authority_ref: providerCandidateRef,
        selected_observation_refs: observationRefs,
        assistant_answer: false,
        raw_content_included: false,
      },
      provider_terminal_candidate: {
        schema: "helix.agent_provider_terminal_candidate.v1",
        candidate_id: providerCandidateRef,
        candidate_text: answerText,
        grounded_in_observation_refs: observationRefs,
        normalized_observation_refs: observationRefs,
        evidence_reentry_required: true,
        provider_reasoning_completed: true,
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      },
      provider_reasoning_reentry: {
        schema: "helix.provider_reasoning_reentry.v1",
        turn_id: turnId,
        status: "completed",
        evidence_reentered: true,
        observation_reentered: true,
        input_observation_refs: observationRefs,
        reentered_observation_refs: observationRefs,
        normalized_observation_refs: observationRefs,
        solver_completed: true,
        goal_satisfaction_compatible: true,
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      },
      provider_terminal_authority_bridge: {
        schema: "helix.provider_terminal_authority_bridge.v1",
        turn_id: turnId,
        terminal_authority_granted: true,
        final_visible_answer_authorized: true,
        successful_gateway_observation_refs: observationRefs,
        normalized_observation_refs: observationRefs,
        terminal_answer_authority: null,
        terminal_presentation: null,
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      },
      route_authority_audit: {
        route_authority_ok: true,
      },
      poison_audit: {
        ok: true,
      },
      solver_continuation_observation: {
        schema: "helix.solver_continuation_observation.v1",
        required_next_step: "model.direct_answer",
      },
      tool_rail_failure_triage: {
        schema: "helix.tool_rail_failure_triage.v1",
        rail_status: "fail_closed",
        first_broken_rail: "evidence_reentry",
        rail_failure_code: "missing_evidence_reentry",
        repair_target: "reentry_gate",
        selected_capability: "docs.search",
        executed_capability: "docs.search",
      },
    };
    const committedRouteBlockedPayload = structuredClone(payload);
    const blockedCommittedRoute = committedRouteBlockedPayload.committed_ask_route as Record<string, unknown>;
    const blockedCanonicalGoal = blockedCommittedRoute.canonical_goal as Record<string, unknown>;
    blockedCanonicalGoal.forbidden_terminal_artifact_kinds = ["model_synthesized_answer"];
    const conditionalVisualPayload = structuredClone(payload);
    const conditionalVisualPrompt = [
      "Using that same saved paper, inspect only page 8.",
      "First use the saved machine-readable text to locate the equation labeled (47).",
      "Then use Image Lens only if visual inspection is necessary to verify the equation's displayed layout.",
      "Return separate Text evidence and Visual evidence sections with page-grounded references.",
      "If page-image evidence cannot be materialized, report the exact missing requirement instead of inventing visual findings.",
    ].join(" ");
    const conditionalVisualAnswer = [
      "### Text evidence",
      "Saved machine-readable page-8 text locates equation **(47)** and its constraints. [Saved paper, page 8 text](artifact://paper.pdf#page=8&text)",
      "### Visual evidence",
      "No Image Lens inspection was run: the saved text was sufficient, and no page-image artifact was materialized.",
      "Exact missing requirement: a **rendered page-8 image reference or an Image Lens source ID with pixel bounds**. Without that, I cannot verify visual layout details such as alignment, line breaks, or display positioning.",
    ].join("\n\n");
    conditionalVisualPayload.active_prompt = conditionalVisualPrompt;
    const conditionalCommittedRoute = conditionalVisualPayload.committed_ask_route as Record<string, unknown>;
    const conditionalCanonicalGoal = conditionalCommittedRoute.canonical_goal as Record<string, unknown>;
    conditionalCanonicalGoal.goal_kind = "scholarly_research";
    conditionalCanonicalGoal.required_terminal_kind = "scholarly_research_answer";
    conditionalCanonicalGoal.allowed_terminal_artifact_kinds = ["scholarly_research_answer", "typed_failure"];
    const conditionalRoute = conditionalCommittedRoute.route as Record<string, unknown>;
    conditionalRoute.source_target = "research_library";
    conditionalRoute.target_kind = "research_library";
    const conditionalTerminalProduct = conditionalCommittedRoute.terminal_product as Record<string, unknown>;
    conditionalTerminalProduct.required_terminal_product = "scholarly_research_answer";
    (conditionalVisualPayload.canonical_goal_frame as Record<string, unknown>).required_terminal_kind =
      "scholarly_research_answer";
    const conditionalRouteAuthority = conditionalVisualPayload.route_evidence_authority as Record<string, unknown>;
    conditionalRouteAuthority.required_terminal_kind = "scholarly_research_answer";
    conditionalRouteAuthority.allowed_terminal_artifact_kinds = ["scholarly_research_answer", "typed_failure"];
    (conditionalVisualPayload.provider_terminal_candidate as Record<string, unknown>).candidate_text =
      conditionalVisualAnswer;
    (conditionalVisualPayload.terminal_presentation as Record<string, unknown>).concise_text =
      conditionalVisualAnswer;

    const reconciledCanonicalGoalPayload = structuredClone(payload);
    delete reconciledCanonicalGoalPayload.committed_ask_route;
    delete reconciledCanonicalGoalPayload.route_evidence_authority;
    reconciledCanonicalGoalPayload.canonical_goal_frame = {
      schema: "helix.canonical_goal_frame.v1",
      turn_id: turnId,
      goal_kind: "live_environment",
      required_terminal_kind: "model_synthesized_answer",
      requested_capability:
        "com.casimirbot.minecraft.spatial_region.inspect",
      allowed_terminal_artifact_kinds: ["model_synthesized_answer"],
      forbidden_terminal_artifact_kinds: [],
      source: "committed_route_canonical_goal_reconciliation",
    };
    reconciledCanonicalGoalPayload.provider_terminal_authority_bridge = {
      ...(reconciledCanonicalGoalPayload.provider_terminal_authority_bridge as Record<
        string,
        unknown
      >),
      solver_completed: true,
      goal_satisfaction_compatible: true,
      all_gateway_calls_succeeded: true,
      all_capability_lane_observations_reentry_compatible: true,
      all_observations_reentry_compatible: true,
      normalized_observations_ready: true,
      normalized_observation_packet_count: observationRefs.length,
      evidence_reentry_required: true,
      provider_terminal_candidate_ref: providerCandidateRef,
      terminal_answer_authority:
        reconciledCanonicalGoalPayload.terminal_answer_authority,
      terminal_presentation:
        reconciledCanonicalGoalPayload.terminal_presentation,
    };

    const qualityBlockedPayload = structuredClone(payload);
    qualityBlockedPayload.active_prompt =
      "Return the page count with page-grounded evidence locations.";
    (qualityBlockedPayload.provider_terminal_candidate as Record<string, unknown>).candidate_text =
      "- Page 8: 7 occurrences — `…pdf#page=8&text`";
    (qualityBlockedPayload.terminal_presentation as Record<string, unknown>).concise_text =
      "- Page 8: 7 occurrences — `…pdf#page=8&text`";

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("model_synthesized_answer");
    expect(result.source).toBe("final_answer_draft");
    expect(result.visible_text).toBe(answerText);
    expect(payload.terminal_artifact_kind).toBe("model_synthesized_answer");
    expect(payload.final_answer_source).toBe("final_answer_draft");
    expect(payload.selected_final_answer).toBe(answerText);
    expect(payload.terminal_error_code).toBeUndefined();
    expect(payload.provider_route_product_materialization).toMatchObject({
      schema: "helix.provider_route_product_materialization.v1",
      materialized_terminal_artifact_kind: "model_synthesized_answer",
      selected_observation_refs: observationRefs,
      status: "materialized",
    });
    expect(payload.provider_route_product_quality_gate).toMatchObject({
      schema: "helix.final_answer_draft_quality_gate.v1",
      ok: true,
      violations: [],
    });
    expect(payload.terminal_answer_authority).toMatchObject({
      terminal_kind: "answer",
      terminal_artifact_kind: "model_synthesized_answer",
      final_answer_source: "final_answer_draft",
      server_authoritative: true,
    });
    expect(result.rejected_candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "typed_failure",
        reason: "stale_solver_continuation_superseded_by_provider_route_product",
      }),
    ]));
    expect(result.integrity.post_tool_model_step_satisfied).toBe(true);
    expect(result.integrity.lifecycle_differential_audit).toMatchObject({
      schema: "helix.turn_lifecycle_projection_audit.v1",
      ok: true,
      first_divergence_stage: null,
      scientific_evidence_disposition: "passed",
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(payload.turn_lifecycle_differential_audit).toEqual(
      result.integrity.lifecycle_differential_audit,
    );
    const artifactIndex = buildArtifactQueryIndex({ turnId, payload });
    expect(artifactIndex.tool_turn_chain_audit).toMatchObject({
      reentry_executed: true,
      reentry_proof_source: "runtime_event_log.observation_reentered",
      reentry_proven: true,
      rail_status: "complete",
      rail_failure_code: null,
    });
    expect(artifactIndex.codex_parity_agent_spine_rail_table).toMatchObject({
      reentry_status: "reentered",
      reentry_proof_source: "runtime_event_log.observation_reentered",
      reentry_proven: true,
      rail_status: "complete",
      rail_failure_code: null,
      codex_parity_class: "complete",
    });
    const solverTrace = buildAskTurnSolverTrace({
      turnId,
      promptText: "Summarize the bounded NHM2 whitepaper from the selected Docs evidence.",
      selectedRoute: "/ask",
      terminalArtifactKind: String(payload.terminal_artifact_kind),
      finalAnswerSource: String(payload.final_answer_source),
      payload,
      loopParityTrace: {
        actual_tool_calls: observationRefs.map((resultRef) => ({
          tool_id: "docs.search",
          family: "docs_viewer",
          admitted: true,
          mutating: false,
          result_ref: resultRef,
        })),
        observations_created: observationRefs.map((observationId) => ({
          observation_id: observationId,
          source_kind: "docs_viewer",
        })),
        evidence_selected_for_answer: observationRefs,
        evidence_rejected_for_answer: [],
      },
    });
    expect(solverTrace).toMatchObject({
      completed_solver_path: true,
      route_authority_ok: true,
      terminal_authority_ok: true,
      evidence_reentry: { completed: true },
      evidence_reentry_gate: { violation_codes: [] },
      followup_reasoning: { completed: true },
      solver_short_circuit_flags: [],
    });

    const reconciledCanonicalGoalResult =
      applyHelixTerminalAuthoritySingleWriter({
        turnId,
        threadId: "thread:test",
        payload: reconciledCanonicalGoalPayload,
        artifactLedger: artifacts,
      });
    expect(reconciledCanonicalGoalResult).toMatchObject({
      selected_terminal_artifact_kind: "model_synthesized_answer",
      source: "final_answer_draft",
      visible_text: answerText,
    });
    expect(
      reconciledCanonicalGoalPayload.provider_route_product_materialization,
    ).toMatchObject({
      schema: "helix.provider_route_product_materialization.v1",
      materialized_terminal_artifact_kind: "model_synthesized_answer",
      selected_observation_refs: observationRefs,
      status: "materialized",
    });

    const blockedResult = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload: committedRouteBlockedPayload,
      artifactLedger: artifacts,
    });
    expect(blockedResult.selected_terminal_artifact_kind).toBe("typed_failure");
    expect(committedRouteBlockedPayload.provider_route_product_materialization).toBeUndefined();
    expect(committedRouteBlockedPayload.terminal_error_code).not.toBeUndefined();

    const qualityBlockedResult = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload: qualityBlockedPayload,
      artifactLedger: artifacts,
    });
    expect(qualityBlockedResult.selected_terminal_artifact_kind).toBe("typed_failure");
    expect(qualityBlockedPayload.provider_route_product_quality_gate).toMatchObject({
      ok: false,
      violations: expect.arrayContaining(["invalid_page_evidence_links"]),
    });
    expect(qualityBlockedPayload.terminal_error_code).toBe(
      "provider_route_product_quality_gate_failed",
    );
    expect(qualityBlockedPayload.terminal_error_code).not.toBe(
      "post_tool_model_step_missing",
    );
    expect(
      qualityBlockedPayload.provider_route_product_materialization_diagnostic,
    ).toMatchObject({
      quality_gate_rejection_classification:
        "recoverable_synthesis_rejection",
    });
    expect(qualityBlockedPayload.typed_failure).toMatchObject({
      schema: "helix.typed_failure.v1",
      error_code: "provider_route_product_quality_gate_failed",
      rejected_terminal_artifact_kind: "model_synthesized_answer",
      quality_gate_violations: expect.arrayContaining([
        "invalid_page_evidence_links",
      ]),
    });
    expect(
      qualityBlockedResult.integrity.lifecycle_differential_audit,
    ).toMatchObject({
      ok: false,
      first_divergence_stage: "followup_reasoning",
      scientific_evidence_disposition: "repair_pending",
      continuity_checks: expect.arrayContaining([
        expect.objectContaining({
          check: "evidence_quality_gate",
          status: "failed",
          disposition: "informational",
        }),
        expect.objectContaining({
          check: "recoverable_rejection_reentered",
          status: "failed",
          disposition: "adapter_projection_contradiction",
        }),
      ]),
    });
    expect(qualityBlockedPayload.terminal_rejection_observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rejection_reason: "route_requires_synthesis",
          gate: "provider_route_product_quality_gate",
          reason_codes: expect.arrayContaining([
            "invalid_page_evidence_links",
          ]),
          evidence_refs: expect.arrayContaining(observationRefs),
          recoverable: true,
          retryability: "retryable",
        }),
      ]),
    );
    expect(qualityBlockedPayload.agent_continuation_state).toMatchObject({
      trigger: "terminal_rejection",
      allowed_decisions: ["retry"],
    });
    expect(qualityBlockedResult.rejected_candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: "route_requires_synthesis" }),
    ]));

    const conditionalVisualResult = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload: conditionalVisualPayload,
      artifactLedger: artifacts,
    });
    expect(conditionalVisualResult.selected_terminal_artifact_kind).toBe("scholarly_research_answer");
    expect(conditionalVisualResult.visible_text).toBe(conditionalVisualAnswer);
    expect(conditionalVisualPayload.provider_route_product_quality_gate).toMatchObject({
      ok: true,
      violations: [],
    });
    expect(conditionalVisualResult.rejected_candidates).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: "route_requires_synthesis" }),
    ]));
  });

  it("preserves a current-turn Docs provider answer while committed-route projection is pending", () => {
    const turnId = "ask:test:docs-provider-projection-gap";
    const observationRef = `${turnId}:workstation_gateway:docs.search:1`;
    const candidateRef = `${turnId}:agent_provider_terminal_candidate:codex:docs`;
    const answerText = "The terminal-authority document defines one server-owned writer for visible Ask answers.";
    const artifacts = [{
      artifact_id: observationRef,
      kind: "provider_gateway_observation_packet",
      payload: {
        schema: "helix.agent_step_observation_packet.v1",
        turn_id: turnId,
        capability_key: "docs.search",
        status: "succeeded",
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      },
    }];
    const authority = {
      schema: "helix.turn_terminal_authority.v1",
      turn_id: turnId,
      terminal_kind: "answer",
      terminal_artifact_kind: "agent_provider_terminal_candidate",
      final_answer_source: "agent_provider_terminal_candidate",
      terminal_item_id: candidateRef,
      server_authoritative: true,
    };
    const presentation = {
      schema: "helix.terminal_presentation.v1",
      turn_id: turnId,
      concise_text: answerText,
      terminal_artifact_kind: "agent_provider_terminal_candidate",
      final_answer_source: "agent_provider_terminal_candidate",
      terminal_authority_ref: candidateRef,
      selected_observation_refs: [observationRef],
    };
    const providerCandidate = {
      schema: "helix.agent_provider_terminal_candidate.v1",
      turn_id: turnId,
      candidate_id: candidateRef,
      candidate_text: answerText,
      grounded_in_observation_refs: [observationRef],
      normalized_observation_refs: [observationRef],
      provider_reasoning_completed: true,
      terminal_eligible: false,
    };
    const makePayload = (): Record<string, unknown> => ({
      turn_id: turnId,
      thread_id: "thread:test",
      canonical_goal_frame: {
        schema: "helix.canonical_goal_frame.v1",
        turn_id: turnId,
        goal_kind: "agent_provider_gateway_turn",
        requested_capability: "docs.search",
        required_terminal_kind: "model_synthesized_answer",
        source: "codex_provider_workstation_gateway_projection",
      },
      provider_reasoning_reentry: {
        schema: "helix.provider_reasoning_reentry.v1",
        turn_id: turnId,
        status: "completed",
        normalized_observation_refs: [observationRef],
        normalized_observation_packet_count: 1,
        evidence_reentry_required: true,
        evidence_reentered: true,
        solver_completed: true,
        goal_satisfaction_compatible: true,
      },
      provider_terminal_candidate: providerCandidate,
      provider_terminal_authority_bridge: {
        schema: "helix.provider_terminal_authority_bridge.v1",
        turn_id: turnId,
        provider_terminal_candidate_ref: candidateRef,
        normalized_observation_refs: [observationRef],
        normalized_observation_packet_count: 1,
        all_gateway_calls_succeeded: true,
        all_capability_lane_observations_succeeded: true,
        all_observations_succeeded: true,
        normalized_observations_ready: true,
        evidence_reentry_required: true,
        solver_completed: true,
        goal_satisfaction_compatible: true,
        terminal_authority_status: "authorized_by_helix_provider_candidate_bridge",
        terminal_authority_granted: true,
        final_visible_answer_authorized: true,
        terminal_answer_authority: authority,
        terminal_presentation: presentation,
        provider_terminal_candidate: providerCandidate,
      },
      terminal_answer_authority: { terminal_kind: "failure", final_answer_source: "typed_failure" },
      terminal_presentation: { turn_id: turnId, concise_text: "stale failure", terminal_artifact_kind: "typed_failure" },
      current_turn_artifact_ledger: artifacts,
    });

    const payload = makePayload();
    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: artifacts,
    });

    expect(result).toMatchObject({
      selected_terminal_artifact_kind: "model_synthesized_answer",
      visible_text: answerText,
    });
    expect(payload.terminal_error_code).toBeUndefined();

    const staleBridgePayload = makePayload();
    (staleBridgePayload.provider_terminal_authority_bridge as Record<string, unknown>).turn_id = "ask:test:stale";
    expect(applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload: staleBridgePayload,
      artifactLedger: artifacts,
    }).selected_terminal_artifact_kind).toBe("typed_failure");

    const incompleteReentryPayload = makePayload();
    (incompleteReentryPayload.provider_reasoning_reentry as Record<string, unknown>).evidence_reentered = false;
    expect(applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload: incompleteReentryPayload,
      artifactLedger: artifacts,
    }).selected_terminal_artifact_kind).toBe("typed_failure");

    const mismatchedGoalPayload = makePayload();
    (mismatchedGoalPayload.canonical_goal_frame as Record<string, unknown>).required_terminal_kind = "repo_code_evidence_answer";
    expect(applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload: mismatchedGoalPayload,
      artifactLedger: artifacts,
    }).selected_terminal_artifact_kind).toBe("typed_failure");

    const forbiddenRoutePayload = makePayload();
    forbiddenRoutePayload.committed_ask_route = {
      schema: "helix.committed_ask_route.v1",
      turn_id: turnId,
      route: {
        selected_route: "/ask/turn",
        source_target: "docs_viewer",
        target_kind: "docs_viewer",
        strength: "hard",
      },
      canonical_goal: {
        required_terminal_kind: "typed_failure",
        allowed_terminal_artifact_kinds: ["typed_failure"],
        forbidden_terminal_artifact_kinds: ["model_synthesized_answer"],
      },
      capability_policy: {
        allowed_tool_families: ["docs_viewer"],
        suppressed_tool_families: [],
        required_capability_families: ["docs_viewer"],
        mutating_families_allowed: false,
      },
      terminal_product: {
        terminal_authority_required: true,
        evidence_reentry_required: true,
        followup_reasoning_required: true,
        required_terminal_product: "typed_failure",
      },
    };
    expect(applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload: forbiddenRoutePayload,
      artifactLedger: artifacts,
    }).selected_terminal_artifact_kind).toBe("typed_failure");
  });

  it("materializes an authorized scholarly answer after lookup and full-text steps stay within one route family", () => {
    const turnId = "ask:test:scholarly-provider-same-family-pipeline";
    const lookupRef = `${turnId}:workstation_gateway:scholarly-research.lookup_papers:1`;
    const fullTextRef = `${turnId}:workstation_gateway:scholarly-research.fetch_full_text:1`;
    const observationRefs = [lookupRef, fullTextRef];
    const providerCandidateRef = `${turnId}:agent_provider_terminal_candidate:codex:scholarly`;
    const answerText = [
      "The selected magnetar paper was fetched as machine-readable full text.",
      "It reports observing frequencies, flux-density changes, pulse-profile evolution, and scatter broadening.",
      "The reported measurements are grounded in the selected scholarly observations.",
    ].join(" ");
    const artifacts = [
      {
        artifact_id: lookupRef,
        kind: "provider_gateway_observation_packet",
        payload: {
          schema: "helix.agent_step_observation_packet.v1",
          turn_id: turnId,
          capability_key: "scholarly-research.lookup_papers",
          status: "succeeded",
          terminal_eligible: false,
          post_tool_model_step_required: true,
          assistant_answer: false,
          raw_content_included: false,
        },
      },
      {
        artifact_id: fullTextRef,
        kind: "provider_gateway_observation_packet",
        payload: {
          schema: "helix.agent_step_observation_packet.v1",
          turn_id: turnId,
          capability_key: "scholarly-research.fetch_full_text",
          status: "succeeded",
          terminal_eligible: false,
          post_tool_model_step_required: true,
          assistant_answer: false,
          raw_content_included: false,
        },
      },
    ];
    const terminalAuthority = {
      schema: "helix.turn_terminal_authority.v1",
      thread_id: "thread:test",
      turn_id: turnId,
      route: "/ask",
      terminal_kind: "answer",
      final_answer_source: "agent_provider_terminal_candidate",
      terminal_artifact_kind: "agent_provider_terminal_candidate",
      terminal_item_id: providerCandidateRef,
      server_authoritative: true,
      terminal_eligible: true,
      assistant_answer: false,
      raw_content_included: false,
    };
    const terminalPresentation = {
      schema: "helix.terminal_presentation.v1",
      turn_id: turnId,
      concise_text: answerText,
      terminal_artifact_kind: "agent_provider_terminal_candidate",
      final_answer_source: "agent_provider_terminal_candidate",
      terminal_authority_ref: providerCandidateRef,
      selected_observation_refs: observationRefs,
      assistant_answer: false,
      raw_content_included: false,
    };
    const providerCandidate = {
      schema: "helix.agent_provider_terminal_candidate.v1",
      candidate_id: providerCandidateRef,
      turn_id: turnId,
      candidate_text: answerText,
      grounded_in_observation_refs: observationRefs,
      normalized_observation_refs: observationRefs,
      evidence_reentry_required: true,
      provider_reasoning_completed: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    };
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      active_prompt: "Can you get the PDF for that paper and tell me what measurements it reports?",
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        source_target: "scholarly_research",
        required_terminal_kind: "scholarly_research_answer",
        allowed_terminal_artifact_kinds: ["scholarly_research_answer", "typed_failure"],
      },
      canonical_goal_frame: {
        schema: "helix.canonical_goal_frame.v1",
        goal_kind: "agent_provider_gateway_turn",
        required_terminal_kind: "scholarly_research_answer",
      },
      capability_itinerary: {
        schema: "helix.capability_itinerary.v1",
        prompt_shape: "source_backed",
        relevant_tool_families: ["scholarly_research"],
        terminal_success_criteria: {
          required_observation_families: ["scholarly_research"],
          requires_post_observation_synthesis: true,
        },
      },
      compound_capability_contract: {
        schema: "helix.compound_capability_contract.v1",
        turn_id: turnId,
        requires_all_subgoals: true,
        terminal_policy: "synthesize_from_satisfied_subgoal_observations",
        subgoals: [
          {
            subgoal_id: `${turnId}:codex_compound_subgoal:1`,
            requested_capability: "scholarly-research.lookup_papers",
            runtime_capability: "scholarly-research.lookup_papers",
          },
          {
            subgoal_id: `${turnId}:codex_compound_subgoal:2`,
            requested_capability: "scholarly-research.fetch_full_text",
            runtime_capability: "scholarly-research.fetch_full_text",
          },
        ],
      },
      current_turn_artifact_ledger: artifacts,
      terminal_answer_authority: terminalAuthority,
      terminal_presentation: terminalPresentation,
      provider_terminal_candidate: providerCandidate,
      provider_reasoning_reentry: {
        schema: "helix.provider_reasoning_reentry.v1",
        turn_id: turnId,
        status: "completed",
        evidence_reentered: true,
        solver_completed: true,
        goal_satisfaction_compatible: true,
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      },
      provider_terminal_authority_bridge: {
        schema: "helix.provider_terminal_authority_bridge.v1",
        turn_id: turnId,
        solver_completed: true,
        goal_satisfaction_compatible: true,
        normalized_observations_ready: true,
        all_observations_succeeded: true,
        terminal_authority_granted: true,
        final_visible_answer_authorized: true,
        successful_gateway_observation_refs: observationRefs,
        normalized_observation_refs: observationRefs,
        terminal_answer_authority: terminalAuthority,
        terminal_presentation: terminalPresentation,
        provider_terminal_candidate: providerCandidate,
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      },
      goal_satisfaction_evaluation: {
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("scholarly_research_answer");
    expect(result.visible_text).toBe(answerText);
    expect(payload.provider_route_product_materialization).toMatchObject({
      materialized_terminal_artifact_kind: "scholarly_research_answer",
      selected_observation_refs: observationRefs,
      status: "materialized",
    });
    expect(payload.provider_route_product_materialization_diagnostic).toMatchObject({
      required_terminal_kind: "scholarly_research_answer",
      provider_route_product_materialized: true,
      provider_route_product_eligibility: {
        target_kind: "scholarly_research_answer",
        route_allows_target_kind: true,
        rejection_reason: null,
      },
    });
    expect(payload.terminal_error_code).toBeUndefined();
    expect(payload.terminal_answer_authority).toMatchObject({
      terminal_kind: "answer",
      terminal_artifact_kind: "scholarly_research_answer",
      final_answer_source: "scholarly_research_answer",
      server_authoritative: true,
    });
    expect(payload.terminal_presentation).toMatchObject({
      terminal_artifact_kind: "scholarly_research_answer",
      final_answer_source: "scholarly_research_answer",
      concise_text: answerText,
      selected_observation_refs: observationRefs,
    });
    expect(payload.typed_failure).toBeUndefined();
  });

  it("preserves a current scholarly terminal when no duplicate top-level answer artifact exists", () => {
    const turnId = "ask:test:scholarly-current-terminal-envelope";
    const observationRef = `${turnId}:workstation_gateway:scholarly-research.lookup_papers:1`;
    const answerRef = `${turnId}:scholarly_research_answer`;
    const answerText = "The lookup found current magnetar research and returned a grounded reading list.";
    const artifacts = [{
      artifact_id: observationRef,
      kind: "provider_gateway_observation_packet",
      payload: {
        schema: "helix.agent_step_observation_packet.v1",
        turn_id: turnId,
        capability_key: "scholarly-research.lookup_papers",
        status: "succeeded",
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      },
    }];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      active_prompt: "Can you cite research about magnetars?",
      canonical_goal_frame: {
        turn_id: turnId,
        goal_kind: "model_only_concept",
        answer_scope: "model_only",
        required_terminal_kind: "direct_answer_text",
      },
      committed_ask_route: {
        schema: "helix.committed_ask_route.v1",
        turn_id: turnId,
        canonical_goal: {
          goal_kind: "scholarly_research",
          required_terminal_kind: "scholarly_research_answer",
          allowed_terminal_artifact_kinds: ["scholarly_research_answer", "typed_failure"],
          forbidden_terminal_artifact_kinds: ["direct_answer_text"],
        },
        route: {
          selected_route: "/ask/turn",
          source_target: "scholarly_research",
          target_kind: "scholarly_research",
          strength: "hard",
          route_reason: "explicit_capability_contract",
        },
        capability_policy: {
          allowed_tool_families: ["scholarly_research"],
          suppressed_tool_families: [],
          required_capability_families: ["scholarly_research"],
          mutating_families_allowed: false,
        },
        terminal_product: {
          terminal_authority_required: true,
          evidence_reentry_required: true,
          followup_reasoning_required: false,
          required_terminal_product: "scholarly_research_answer",
        },
      },
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        source_target: "scholarly_research",
        required_terminal_kind: "scholarly_research_answer",
        allowed_terminal_artifact_kinds: ["scholarly_research_answer", "typed_failure"],
      },
      route_evidence_authority: {
        schema: "helix.route_evidence_authority.v1",
        turn_id: turnId,
        allowed_terminal_artifact_kinds: ["scholarly_research_answer", "typed_failure"],
        forbidden_terminal_artifact_kinds: ["direct_answer_text"],
        required_terminal_kind: "scholarly_research_answer",
        terminal_product_allowed: true,
        current_turn_only: true,
      },
      capability_itinerary: {
        schema: "helix.capability_itinerary.v1",
        prompt_shape: "source_backed",
        relevant_tool_families: ["scholarly_research"],
        terminal_success_criteria: {
          required_observation_families: ["scholarly_research"],
          requires_post_observation_synthesis: true,
        },
      },
      current_turn_artifact_ledger: artifacts,
      terminal_artifact_kind: "scholarly_research_answer",
      final_answer_source: "scholarly_research_answer",
      selected_final_answer: answerText,
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        thread_id: "thread:test",
        turn_id: turnId,
        route: "/ask/turn",
        terminal_kind: "answer",
        terminal_artifact_kind: "scholarly_research_answer",
        final_answer_source: "scholarly_research_answer",
        terminal_item_id: answerRef,
        server_authoritative: true,
      },
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        turn_id: turnId,
        terminal_artifact_kind: "scholarly_research_answer",
        final_answer_source: "scholarly_research_answer",
        terminal_authority_ref: answerRef,
        selected_observation_refs: [observationRef],
        concise_text: answerText,
      },
      provider_reasoning_reentry: {
        schema: "helix.provider_reasoning_reentry.v1",
        turn_id: turnId,
        status: "completed",
        normalized_observation_refs: [observationRef],
        normalized_observation_packet_count: 1,
        evidence_reentry_required: true,
        evidence_reentered: true,
        solver_completed: true,
        goal_satisfaction_compatible: true,
      },
      provider_terminal_authority_bridge: {
        schema: "helix.provider_terminal_authority_bridge.v1",
        turn_id: turnId,
        solver_completed: true,
        goal_satisfaction_compatible: true,
        normalized_observations_ready: true,
        all_observations_succeeded: true,
        all_gateway_calls_succeeded: true,
        all_capability_lane_observations_succeeded: true,
        terminal_authority_status: "authorized_by_helix_provider_candidate_bridge",
        terminal_authority_granted: true,
        final_visible_answer_authorized: true,
        successful_gateway_observation_refs: [observationRef],
        normalized_observation_refs: [observationRef],
      },
      goal_satisfaction_evaluation: {
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("scholarly_research_answer");
    expect(result.visible_text).toBe(answerText);
    expect(payload.terminal_answer_envelope).toMatchObject({
      terminal_artifact_kind: "scholarly_research_answer",
      final_answer_source: "scholarly_research_answer",
      terminal_text: answerText,
      terminal_kind: "answer",
    });
    expect(payload.terminal_error_code).toBeUndefined();
    expect(payload.typed_failure).toBeUndefined();
  });

  it("prefers a persisted current-turn authorized provider bridge over a later unauthorized recovery projection", () => {
    const turnId = "ask:test:docs-provider-bridge-recovery";
    const observationRef = `${turnId}:workstation_gateway:docs.search:1`;
    const providerCandidateRef = `${turnId}:agent_provider_terminal_candidate:codex:docs`;
    const answerText = "The document answer remains grounded in the current Docs observation.";
    const authorizedAuthority = {
      schema: "helix.turn_terminal_authority.v1",
      thread_id: "thread:test",
      turn_id: turnId,
      route: "/ask",
      terminal_kind: "answer",
      final_answer_source: "agent_provider_terminal_candidate",
      terminal_artifact_kind: "agent_provider_terminal_candidate",
      terminal_item_id: providerCandidateRef,
      server_authoritative: true,
    };
    const authorizedPresentation = {
      schema: "helix.terminal_presentation.v1",
      turn_id: turnId,
      concise_text: answerText,
      terminal_artifact_kind: "agent_provider_terminal_candidate",
      final_answer_source: "agent_provider_terminal_candidate",
      terminal_authority_ref: providerCandidateRef,
      selected_observation_refs: [observationRef],
    };
    const artifacts = [{
      artifact_id: observationRef,
      kind: "provider_gateway_observation_packet",
      payload: {
        schema: "helix.agent_step_observation_packet.v1",
        turn_id: turnId,
        capability_key: "docs.search",
        status: "succeeded",
      },
    }];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      current_turn_artifact_ledger: artifacts,
      committed_ask_route: {
        schema: "helix.committed_ask_route.v1",
        turn_id: turnId,
        prompt_hash: "hash:docs-provider-bridge-recovery",
        route: { selected_route: "/ask", source_target: "docs_viewer" },
        canonical_goal: {
          goal_kind: "docs",
          required_terminal_kind: "model_synthesized_answer",
          allowed_terminal_artifact_kinds: ["model_synthesized_answer", "typed_failure"],
        },
      },
      canonical_goal_frame: { goal_kind: "docs", required_terminal_kind: "model_synthesized_answer" },
      route_evidence_authority: {
        turn_id: turnId,
        terminal_product_allowed: true,
        required_terminal_kind: "model_synthesized_answer",
        allowed_terminal_artifact_kinds: ["model_synthesized_answer", "typed_failure"],
      },
      terminal_answer_authority: { terminal_kind: "failure", final_answer_source: "typed_failure" },
      terminal_presentation: { turn_id: turnId, concise_text: "stale failure", terminal_artifact_kind: "typed_failure" },
      provider_terminal_authority_bridge: {
        turn_id: turnId,
        terminal_authority_granted: true,
        final_visible_answer_authorized: true,
        terminal_answer_authority: authorizedAuthority,
        terminal_presentation: authorizedPresentation,
      },
      provider_terminal_candidate: {
        candidate_id: providerCandidateRef,
        candidate_text: answerText,
        grounded_in_observation_refs: [observationRef],
        normalized_observation_refs: [observationRef],
      },
      solver_continuation_observation: { required_next_step: "model.direct_answer" },
    };
    const persistedBridge = payload.provider_terminal_authority_bridge as Record<string, unknown>;
    payload.provider_terminal_authority_bridge = {
      schema: "helix.provider_terminal_authority_bridge.v1",
      turn_id: turnId,
      terminal_authority_granted: false,
      final_visible_answer_authorized: false,
      terminal_authority_status: "blocked_by_missing_normalized_observations",
      provider_terminal_candidate: {
        candidate_id: `${turnId}:agent_provider_terminal_candidate:codex:unauthorized-recovery`,
        candidate_text: "A later unauthorized recovery projection.",
        grounded_in_observation_refs: [],
        normalized_observation_refs: [],
        evidence_reentry_required: false,
      },
    };
    payload.provider_terminal_candidate = {
      candidate_id: `${turnId}:agent_provider_terminal_candidate:codex:unauthorized-recovery`,
      candidate_text: "A later unauthorized recovery projection.",
      grounded_in_observation_refs: [],
      normalized_observation_refs: [],
      evidence_reentry_required: false,
    };
    artifacts.push({
      artifact_id: `${turnId}:provider_terminal_authority_bridge:terminal_recovery`,
      kind: "provider_terminal_authority_bridge",
      payload: {
        ...persistedBridge,
        provider_terminal_candidate: payload.provider_terminal_candidate,
      },
    });

    const materialized = materializeAgentProviderRouteProductTerminal({
      payload,
      artifacts,
      turnId,
      requiredTerminalKind: "model_synthesized_answer",
      routeAllowsTerminalKind: (kind) => kind === "model_synthesized_answer",
    });

    expect(materialized).toMatchObject({
      kind: "model_synthesized_answer",
      text: answerText,
      supportRefs: [observationRef],
    });
    expect(inspectAgentProviderRouteProductEligibility({
      payload,
      artifacts,
      turnId,
      requiredTerminalKind: "model_synthesized_answer",
      routeAllowsTerminalKind: (kind) => kind === "model_synthesized_answer",
    })).toMatchObject({
      provider_bridge_source: "current_turn_artifact",
      provider_bridge_authorizes_candidate: true,
      authority_shape_valid: true,
      presentation_shape_valid: true,
      current_turn_support_ref_count: 1,
      rejection_reason: null,
    });
  });

  it("materializes an authorized provider candidate as a route-required document summary", () => {
    const turnId = "ask:test:provider-doc-summary-route-product";
    const observationRef = `${turnId}:codex_normalized:retrieval_context:1`;
    const providerCandidateRef = `${turnId}:agent_provider_terminal_candidate:codex:doc-summary`;
    const answerText = "The document separates measured Casimir observables from speculative DP and quantum-foam bridges.";
    const terminalAuthority = {
      schema: "helix.turn_terminal_authority.v1",
      thread_id: "thread:test",
      turn_id: turnId,
      route: "/ask/turn",
      terminal_kind: "answer",
      final_answer_source: "agent_provider_terminal_candidate",
      terminal_artifact_kind: "agent_provider_terminal_candidate",
      terminal_item_id: providerCandidateRef,
      server_authoritative: true,
    };
    const terminalPresentation = {
      schema: "helix.terminal_presentation.v1",
      turn_id: turnId,
      concise_text: answerText,
      terminal_artifact_kind: "agent_provider_terminal_candidate",
      final_answer_source: "agent_provider_terminal_candidate",
      terminal_authority_ref: providerCandidateRef,
      selected_observation_refs: [observationRef],
    };
    const artifacts = [{
      artifact_id: observationRef,
      kind: "retrieval_context",
      payload: {
        schema: "helix.retrieval_context.v1",
        turn_id: turnId,
        path: "docs/research/casimir-dp-quantum-foam-study.md",
        excerpt: "Measured Casimir and DP diagnostic lanes remain separate.",
      },
    }];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      canonical_goal_frame: {
        goal_kind: "doc_summary",
        required_terminal_kind: "doc_summary",
      },
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        required_terminal_kind: "doc_summary",
        allowed_terminal_artifact_kinds: ["doc_summary", "typed_failure"],
      },
      terminal_answer_authority: terminalAuthority,
      terminal_presentation: terminalPresentation,
      provider_terminal_candidate: {
        candidate_id: providerCandidateRef,
        candidate_text: answerText,
        grounded_in_observation_refs: [observationRef],
        normalized_observation_refs: [observationRef],
      },
      provider_terminal_authority_bridge: {
        schema: "helix.provider_terminal_authority_bridge.v1",
        turn_id: turnId,
        terminal_authority_granted: true,
        final_visible_answer_authorized: true,
        evidence_reentry_required: true,
        terminal_answer_authority: terminalAuthority,
        terminal_presentation: terminalPresentation,
      },
    };

    const materialized = materializeAgentProviderRouteProductTerminal({
      payload,
      artifacts,
      turnId,
      requiredTerminalKind: "doc_summary",
      routeAllowsTerminalKind: (kind) => kind === "doc_summary",
    });

    expect(materialized).toMatchObject({
      kind: "doc_summary",
      text: answerText,
      supportRefs: [observationRef],
      artifact: {
        kind: "doc_summary",
        payload: {
          schema: "helix.doc_summary.v1",
          provider_terminal_candidate_ref: providerCandidateRef,
        },
      },
    });
    expect(inspectAgentProviderRouteProductEligibility({
      payload,
      artifacts,
      turnId,
      requiredTerminalKind: "doc_summary",
      routeAllowsTerminalKind: (kind) => kind === "doc_summary",
    })).toMatchObject({
      target_kind: "doc_summary",
      provider_authored_target_kind: true,
      route_allows_target_kind: true,
      current_turn_support_ref_count: 1,
      rejection_reason: null,
    });
  });

  it("admits only exact current-turn revalidated environment evidence as provider support", () => {
    const turnId = "ask:test:prior-environment-route-product";
    const observationRef = `${turnId}:prior_environment_probe_evidence:verified`;
    const providerCandidateRef = `${turnId}:agent_provider_terminal_candidate:codex:environment`;
    const answerText =
      "Line of sight and range are established, but a navigable path is not.";
    const terminalAuthority = {
      schema: "helix.turn_terminal_authority.v1",
      thread_id: "helix-ask:room:room:test",
      turn_id: turnId,
      route: "/ask/turn",
      terminal_kind: "answer",
      final_answer_source: "agent_provider_terminal_candidate",
      terminal_artifact_kind: "agent_provider_terminal_candidate",
      terminal_item_id: providerCandidateRef,
      server_authoritative: true,
    };
    const terminalPresentation = {
      schema: "helix.terminal_presentation.v1",
      turn_id: turnId,
      concise_text: answerText,
      terminal_artifact_kind: "agent_provider_terminal_candidate",
      final_answer_source: "agent_provider_terminal_candidate",
      terminal_authority_ref: providerCandidateRef,
      selected_observation_refs: [observationRef],
    };
    const verifiedArtifact = {
      artifact_id: observationRef,
      kind: "prior_environment_probe_evidence",
      turn_id: turnId,
      source_scope: "prior_turn_context",
      producer_item_id: "conversation_memory_environment_evidence_reentry",
      status: "succeeded",
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      payload: {
        schema: "helix.environment_connector.prior_probe_evidence.v1",
        prior_turn_id: "ask:test:prior-environment-source",
        probe_request_ref: "environment_probe_request:verified",
        room_id: "room:test",
        source_id: "source:test",
        world_id: "minecraft:test",
        capability_id: "com.casimirbot.minecraft.reachability.check",
        observation: {
          schema: "helix.environment_connector.probe_observation.v1",
          outcome: "succeeded",
          provenance_valid: true,
          eligible_for_current_turn_reentry: true,
          content_role:
            "environment_probe_observation_not_assistant_answer",
          reentry_required: true,
          answer_authority: false,
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
        content_role:
          "prior_environment_probe_evidence_not_assistant_answer",
        reentry_required: true,
        answer_authority: false,
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      },
    };
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      provider_terminal_candidate: {
        candidate_id: providerCandidateRef,
        candidate_text: answerText,
        grounded_in_observation_refs: [observationRef],
        normalized_observation_refs: [observationRef],
        evidence_reentry_required: true,
      },
      provider_terminal_authority_bridge: {
        schema: "helix.provider_terminal_authority_bridge.v1",
        turn_id: turnId,
        terminal_authority_granted: true,
        final_visible_answer_authorized: true,
        evidence_reentry_required: true,
        terminal_answer_authority: terminalAuthority,
        terminal_presentation: terminalPresentation,
      },
      terminal_answer_authority: terminalAuthority,
      terminal_presentation: terminalPresentation,
    };
    const inspect = (artifact: typeof verifiedArtifact) =>
      inspectAgentProviderRouteProductEligibility({
        payload,
        artifacts: [artifact],
        turnId,
        requiredTerminalKind: "model_synthesized_answer",
        routeAllowsTerminalKind: (kind) =>
          kind === "model_synthesized_answer",
      });

    expect(inspect(verifiedArtifact)).toMatchObject({
      current_turn_support_ref_count: 1,
      rejection_reason: null,
    });
    expect(
      materializeAgentProviderRouteProductTerminal({
        payload,
        artifacts: [verifiedArtifact],
        turnId,
        requiredTerminalKind: "model_synthesized_answer",
        routeAllowsTerminalKind: (kind) =>
          kind === "model_synthesized_answer",
      }),
    ).toMatchObject({
      kind: "model_synthesized_answer",
      text: answerText,
      supportRefs: [observationRef],
    });
    for (const forged of [
      {
        ...verifiedArtifact,
        payload: {
          ...verifiedArtifact.payload,
          observation: {
            ...verifiedArtifact.payload.observation,
            provenance_valid: false,
          },
        },
      },
      {
        ...verifiedArtifact,
        payload: {
          ...verifiedArtifact.payload,
          observation: {
            ...verifiedArtifact.payload.observation,
            outcome: "failed",
          },
        },
      },
      {
        ...verifiedArtifact,
        payload: {
          ...verifiedArtifact.payload,
          answer_authority: true,
        },
      },
    ]) {
      expect(inspect(forged)).toMatchObject({
        current_turn_support_ref_count: 0,
        rejection_reason: "current_turn_support_refs_missing",
      });
      expect(
        materializeAgentProviderRouteProductTerminal({
          payload,
          artifacts: [forged],
          turnId,
          requiredTerminalKind: "model_synthesized_answer",
          routeAllowsTerminalKind: (kind) =>
            kind === "model_synthesized_answer",
        }),
      ).toBeNull();
    }
  });

  it("materializes an authorized provider candidate as route-required direct answer text", () => {
    const turnId = "ask:test:provider-direct-answer-route-product";
    const observationRef = `${turnId}:capability_lane:live_translation.translate_text:1`;
    const providerCandidateRef = `${turnId}:agent_provider_terminal_candidate:codex:translation`;
    const answerText = "The translation is hola.";
    const terminalAuthority = {
      schema: "helix.turn_terminal_authority.v1",
      thread_id: "thread:test",
      turn_id: turnId,
      route: "/ask/turn",
      terminal_kind: "answer",
      final_answer_source: "agent_provider_terminal_candidate",
      terminal_artifact_kind: "agent_provider_terminal_candidate",
      terminal_item_id: providerCandidateRef,
      server_authoritative: true,
    };
    const terminalPresentation = {
      schema: "helix.terminal_presentation.v1",
      turn_id: turnId,
      concise_text: answerText,
      terminal_artifact_kind: "agent_provider_terminal_candidate",
      final_answer_source: "agent_provider_terminal_candidate",
      terminal_authority_ref: providerCandidateRef,
      selected_observation_refs: [observationRef],
    };
    const artifacts = [{
      artifact_id: observationRef,
      kind: "agent_step_observation_packet",
      payload: {
        schema: "helix.agent_step_observation_packet.v1",
        turn_id: turnId,
        capability_key: "live_translation.translate_text",
        status: "succeeded",
      },
    }];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      active_prompt: "Translate hello to Spanish.",
      committed_ask_route: {
        schema: "helix.committed_ask_route.v1",
        turn_id: turnId,
        route: { selected_route: "/ask/turn", source_target: "model_only" },
        canonical_goal: {
          goal_kind: "model_only_concept",
          required_terminal_kind: "direct_answer_text",
          allowed_terminal_artifact_kinds: ["direct_answer_text", "typed_failure"],
        },
      },
      canonical_goal_frame: {
        goal_kind: "model_only_concept",
        required_terminal_kind: "direct_answer_text",
      },
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        required_terminal_kind: "direct_answer_text",
        allowed_terminal_artifact_kinds: ["direct_answer_text", "typed_failure"],
      },
      route_evidence_authority: {
        turn_id: turnId,
        terminal_product_allowed: true,
        required_terminal_kind: "direct_answer_text",
        allowed_terminal_artifact_kinds: ["direct_answer_text", "typed_failure"],
      },
      current_turn_artifact_ledger: artifacts,
      terminal_answer_authority: terminalAuthority,
      terminal_presentation: terminalPresentation,
      provider_terminal_candidate: {
        candidate_id: providerCandidateRef,
        candidate_text: answerText,
        grounded_in_observation_refs: [observationRef],
        normalized_observation_refs: [observationRef],
      },
      provider_terminal_authority_bridge: {
        schema: "helix.provider_terminal_authority_bridge.v1",
        turn_id: turnId,
        terminal_authority_granted: true,
        final_visible_answer_authorized: true,
        terminal_answer_authority: terminalAuthority,
        terminal_presentation: terminalPresentation,
      },
    };

    const materialized = materializeAgentProviderRouteProductTerminal({
      payload,
      artifacts,
      turnId,
      requiredTerminalKind: "direct_answer_text",
      routeAllowsTerminalKind: (kind) => kind === "direct_answer_text",
    });

    expect(materialized).toMatchObject({
      kind: "direct_answer_text",
      text: answerText,
      supportRefs: [observationRef],
      artifact: {
        kind: "direct_answer_text",
        payload: { schema: "helix.direct_answer_text.v1" },
      },
    });
    expect(inspectAgentProviderRouteProductEligibility({
      payload,
      artifacts,
      turnId,
      requiredTerminalKind: "direct_answer_text",
      routeAllowsTerminalKind: (kind) => kind === "direct_answer_text",
    })).toMatchObject({
      target_kind: "direct_answer_text",
      provider_authored_target_kind: true,
      route_allows_target_kind: true,
      rejection_reason: null,
    });
  });

  it("materializes an authorized model-only provider candidate without observation support refs", () => {
    const turnId = "ask:test:model-only-provider-route-product";
    const providerCandidateRef = `${turnId}:agent_provider_terminal_candidate:codex:model-only`;
    const prompt =
      "The screen says `theory-experiment-procedure.prepare`. Explain what that label means, but do not call it or any other tool.";
    const answerText =
      "The quoted label names the preparation step for a theory experiment procedure.";
    const terminalAuthority = {
      schema: "helix.turn_terminal_authority.v1",
      thread_id: "thread:test",
      turn_id: turnId,
      route: "/ask/turn",
      terminal_kind: "answer",
      final_answer_source: "agent_provider_terminal_candidate",
      terminal_artifact_kind: "agent_provider_terminal_candidate",
      terminal_item_id: providerCandidateRef,
      server_authoritative: true,
    };
    const terminalPresentation = {
      schema: "helix.terminal_presentation.v1",
      turn_id: turnId,
      concise_text: answerText,
      terminal_artifact_kind: "agent_provider_terminal_candidate",
      final_answer_source: "agent_provider_terminal_candidate",
      terminal_authority_ref: providerCandidateRef,
      selected_observation_refs: [],
    };
    const providerTerminalCandidate = {
      schema: "helix.agent_provider_terminal_candidate.v1",
      candidate_id: providerCandidateRef,
      candidate_text: answerText,
      grounded_in_observation_refs: [],
      normalized_observation_refs: [],
      evidence_reentry_required: false,
      provider_reasoning_completed: true,
    };
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      source_target_intent: {
        schema: "helix.ask_source_target_intent.v1",
        target_source: "model_only",
        target_kind: "general_background",
        strength: "hard",
        allow_no_tool_direct: true,
      },
      committed_ask_route: {
        schema: "helix.committed_ask_route.v1",
        turn_id: turnId,
        route: { selected_route: "/ask/turn", source_target: "model_only" },
        canonical_goal: {
          goal_kind: "model_only_concept",
          required_terminal_kind: "direct_answer_text",
          allowed_terminal_artifact_kinds: ["direct_answer_text", "typed_failure"],
          forbidden_terminal_artifact_kinds: [],
        },
        compatibility: { compatible: true, violations: [] },
      },
      canonical_goal_frame: {
        goal_kind: "model_only_concept",
        required_terminal_kind: "direct_answer_text",
      },
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        source_target: "model_only",
        required_terminal_kind: "direct_answer_text",
        allowed_terminal_artifact_kinds: ["direct_answer_text", "typed_failure"],
      },
      route_evidence_authority: {
        turn_id: turnId,
        terminal_product_allowed: true,
        required_terminal_kind: "direct_answer_text",
        allowed_terminal_artifact_kinds: ["direct_answer_text", "typed_failure"],
      },
      goal_satisfaction_evaluation: {
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
        required_terminal_kind: "direct_answer_text",
      },
      provider_terminal_candidate: providerTerminalCandidate,
      provider_reasoning_reentry: {
        schema: "helix.provider_reasoning_reentry.v1",
        turn_id: turnId,
        status: "completed",
        evidence_reentry_required: false,
        evidence_reentered: true,
        solver_completed: true,
        goal_satisfaction_compatible: true,
      },
      provider_terminal_authority_bridge: {
        schema: "helix.provider_terminal_authority_bridge.v1",
        turn_id: turnId,
        model_only_direct_answer_allowed: true,
        evidence_reentry_required: false,
        terminal_authority_granted: true,
        final_visible_answer_authorized: true,
        terminal_answer_authority: terminalAuthority,
        terminal_presentation: terminalPresentation,
        provider_terminal_candidate: providerTerminalCandidate,
      },
      terminal_answer_authority: terminalAuthority,
      terminal_presentation: terminalPresentation,
      current_turn_artifact_ledger: [],
      workstation_gateway_call_results: [],
      capability_lane_call_results: [],
    };

    expect(materializeAgentProviderRouteProductTerminal({
      payload,
      artifacts: [],
      turnId,
      requiredTerminalKind: "direct_answer_text",
      routeAllowsTerminalKind: (kind) => kind === "direct_answer_text",
    })).toMatchObject({
      kind: "direct_answer_text",
      text: answerText,
      supportRefs: [],
    });
    expect(inspectAgentProviderRouteProductEligibility({
      payload,
      artifacts: [],
      turnId,
      requiredTerminalKind: "direct_answer_text",
      routeAllowsTerminalKind: (kind) => kind === "direct_answer_text",
    })).toMatchObject({
      provider_bridge_authorizes_candidate: true,
      support_refs_required: false,
      current_turn_support_ref_count: 0,
      rejection_reason: null,
    });

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      prompt,
      payload,
      artifactLedger: [],
    });
    expect(result.selected_terminal_artifact_kind).toBe("direct_answer_text");
    expect(result.visible_text).toContain(answerText);
    expect(result.visible_text).toMatch(
      /I did not execute or call any tool for this explanation\.$/,
    );
    delete payload.committed_ask_route;
    expect(buildAskTurnSolverTrace({
      turnId,
      promptText: String(payload.active_prompt),
      selectedRoute: "/ask/turn",
      terminalArtifactKind: String(payload.terminal_artifact_kind),
      finalAnswerSource: String(payload.final_answer_source),
      payload,
    })).toMatchObject({
      completed_solver_path: true,
      terminal_authority_ok: true,
    });
  });

  it("fails closed with a Moral Graph typed failure when no provider terminal candidate follows observation re-entry", () => {
    const turnId = "ask:test:moral-graph-provider-terminal-missing";
    const observationRef = `${turnId}:codex_normalized:moral_graph_reflection:1`;
    const artifacts = [
      {
        artifact_id: observationRef,
        kind: "moral_graph_reflection",
        payload: {
          schema: "helix.moral_graph_reflection_observation.v1",
          turn_id: turnId,
          capability_key: "moral-graph.reflect_context",
          status: "succeeded",
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      response_type: "final_answer",
      final_status: "completed",
      final_answer_source: "workstation_tool_observation",
      terminal_artifact_kind: "moral_graph_reflection",
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        source_target: "agent_provider_gateway_turn",
        required_terminal_artifact_kind: "agent_provider_terminal_candidate",
        allowed_terminal_artifact_kinds: ["agent_provider_terminal_candidate", "typed_failure"],
        assistant_answer: false,
        raw_content_included: false,
      },
      canonical_goal_frame: {
        schema: "helix.canonical_goal_frame.v1",
        goal_kind: "agent_provider_gateway_turn",
        requested_capability: "moral-graph.reflect_context",
        required_terminal_kind: "agent_provider_terminal_candidate",
        assistant_answer: false,
        raw_content_included: false,
      },
      current_turn_artifact_ledger: artifacts,
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("typed_failure");
    expect(result.source).toBe("typed_failure");
    expect(payload.terminal_error_code).toBe("moral_graph_agent_provider_terminal_candidate_missing");
    expect(String(payload.selected_final_answer)).toContain("Moral Graph observation was produced");
    expect((payload.typed_failure as Record<string, unknown>)).toMatchObject({
      schema: "helix.typed_failure.v1",
      error_code: "moral_graph_agent_provider_terminal_candidate_missing",
      route_family: "moral_graph_reflection",
      required_terminal_artifact_kind: "agent_provider_terminal_candidate",
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(String(payload.selected_final_answer)).not.toMatch(/scholarly|calculator|internet search|PDF\/full-text/i);
    expect(payload.ask_turn_procedure_trace).toMatchObject({
      schema: "helix.ask_turn_procedure_trace.v1",
      intent_class: "agent_provider_gateway_turn",
      evidence_reentry_status: "not_reentered",
      allowed_terminal_products: expect.arrayContaining(["agent_provider_terminal_candidate"]),
      selected_terminal_product: expect.objectContaining({
        kind: "typed_failure",
        allowed_by_route: true,
      }),
      visible_answer_source: "typed_failure",
      failure_rail: "evidence_not_reentered",
    });
  });

  it("allows a model-synthesized answer draft after Moral Graph observation re-entry when the route requires it", () => {
    const turnId = "ask:test:moral-graph-model-synthesis";
    const observationRef = `${turnId}:codex_normalized:moral_graph_reflection:1`;
    const draftRef = `${turnId}:final_answer_draft:1`;
    const answerText =
      "Moral Graph reflection supports a repair-first apology because the direct harm is observable and the next step should preserve trust.";
    const artifacts = [
      {
        artifact_id: observationRef,
        kind: "moral_graph_reflection",
        payload: {
          schema: "helix.moral_graph_reflection_observation.v1",
          turn_id: turnId,
          capability_key: "moral-graph.reflect_context",
          status: "succeeded",
          summary: "Moral Graph observation completed.",
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
      },
      {
        artifact_id: draftRef,
        kind: "final_answer_draft",
        payload: {
          schema: "helix.final_answer_draft.v1",
          turn_id: turnId,
          text: answerText,
          answer_text: answerText,
          support_refs: [observationRef],
          assistant_answer: false,
          terminal_eligible: true,
          raw_content_included: false,
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      response_type: "final_answer",
      final_status: "completed",
      selected_final_answer: answerText,
      final_answer_source: "final_answer_draft",
      terminal_artifact_kind: "model_synthesized_answer",
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        source_target: "moral_graph",
        required_terminal_artifact_kind: "model_synthesized_answer",
        allowed_terminal_artifact_kinds: ["model_synthesized_answer", "typed_failure"],
        assistant_answer: false,
        raw_content_included: false,
      },
      route_evidence_authority: {
        schema: "helix.route_evidence_authority.v1",
        turn_id: turnId,
        candidate_tools: [
          {
            capability_id: "moral-graph.reflect_context",
            family: "moral_graph_reflection",
            reason: "prompt_requested_moral_graph",
          },
        ],
        admitted_tools: [
          {
            capability_id: "moral-graph.reflect_context",
            family: "moral_graph_reflection",
            reason: "current_route_admitted_moral_graph",
            admission_ref: "route:test:moral_graph",
          },
        ],
        rejected_tools: [
          {
            capability_id: "scholarly-research.lookup_papers",
            family: "scholarly_research",
            reason: "explicitly_suppressed_by_prompt",
          },
        ],
        supporting_evidence_refs: [observationRef],
        allowed_terminal_artifact_kinds: ["model_synthesized_answer", "typed_failure"],
        forbidden_terminal_artifact_kinds: ["scholarly_research_answer", "internet_search_answer"],
        required_terminal_kind: "model_synthesized_answer",
        terminal_product_allowed: true,
        current_turn_only: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      canonical_goal_frame: {
        schema: "helix.canonical_goal_frame.v1",
        goal_kind: "moral_graph_reflection",
        requested_capability: "moral-graph.reflect_context",
        required_terminal_kind: "model_synthesized_answer",
        assistant_answer: false,
        raw_content_included: false,
      },
      current_turn_artifact_ledger: artifacts,
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("model_synthesized_answer");
    expect(result.source).toBe("final_answer_draft");
    expect(result.visible_text).toBe(answerText);
    expect(payload.terminal_error_code).toBeUndefined();
    expect(payload.final_answer_source).toBe("final_answer_draft");
    expect(payload.terminal_artifact_kind).toBe("model_synthesized_answer");
    expect(payload.selected_final_answer).toBe(answerText);
    expect(payload.ask_turn_procedure_trace).toMatchObject({
      schema: "helix.ask_turn_procedure_trace.v1",
      intent_class: "moral_graph_reflection",
      evidence_reentry_status: "reentered",
      admitted_capabilities: expect.arrayContaining(["moral-graph.reflect_context"]),
      allowed_terminal_products: expect.arrayContaining(["model_synthesized_answer"]),
      selected_terminal_product: expect.objectContaining({
        kind: "model_synthesized_answer",
        allowed_by_route: true,
      }),
      visible_answer_source: "final_answer_draft",
      failure_rail: null,
    });
  });

  it("does not let route evidence authority admit a scholarly terminal for a Moral Graph turn", () => {
    const turnId = "ask:test:moral-graph-blocks-scholarly-terminal";
    const scholarlyText =
      "I cannot answer scholarly paper content from this turn because no scholarly-research.lookup_papers observation packet was materialized.";
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      response_type: "final_answer",
      final_status: "completed",
      selected_final_answer: scholarlyText,
      final_answer_source: "scholarly_research_answer",
      terminal_artifact_kind: "scholarly_research_answer",
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        source_target: "agent_provider_gateway_turn",
        allowed_terminal_artifact_kinds: ["scholarly_research_answer", "typed_failure"],
        forbidden_terminal_artifact_kinds: [],
        assistant_answer: false,
        raw_content_included: false,
      },
      route_evidence_authority: {
        schema: "helix.route_evidence_authority.v1",
        turn_id: turnId,
        candidate_tools: [
          {
            capability_id: "moral-graph.reflect_context",
            family: "moral_graph_reflection",
            reason: "prompt_requested_moral_graph",
          },
        ],
        admitted_tools: [
          {
            capability_id: "moral-graph.reflect_context",
            family: "moral_graph_reflection",
            reason: "current_route_admitted_moral_graph",
            admission_ref: "route:test",
          },
        ],
        rejected_tools: [
          {
            capability_id: "scholarly-research.lookup_papers",
            family: "scholarly_research",
            reason: "not_requested_by_current_route",
          },
        ],
        supporting_evidence_refs: [],
        allowed_terminal_artifact_kinds: ["agent_provider_terminal_candidate", "typed_failure"],
        forbidden_terminal_artifact_kinds: ["scholarly_research_answer"],
        required_terminal_kind: "agent_provider_terminal_candidate",
        terminal_product_allowed: true,
        current_turn_only: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      canonical_goal_frame: {
        schema: "helix.canonical_goal_frame.v1",
        goal_kind: "agent_provider_gateway_turn",
        requested_capability: "moral-graph.reflect_context",
        required_terminal_kind: "agent_provider_terminal_candidate",
        assistant_answer: false,
        raw_content_included: false,
      },
      current_turn_artifact_ledger: [],
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: [],
    });

    expect(result.selected_terminal_artifact_kind).not.toBe("scholarly_research_answer");
    expect(payload.terminal_artifact_kind).not.toBe("scholarly_research_answer");
    expect(String(payload.selected_final_answer)).not.toBe(scholarlyText);
  });

  it("keeps stale scientific Image Lens sidecars ambient during unrelated Moral Graph turns", () => {
    const turnId = "ask:test:moral-graph-ignores-stale-scientific-sidecar";
    const answerText =
      "Moral Graph reflection supports the boundary as a procedural reflection only.";
    const staleSidecar = {
      artifact_id: "ask:prior:scientific_image_evidence_sidecar",
      kind: "scientific_image_evidence_sidecar",
      source_scope: "prior_turn_context",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
      payload: {
        schema: "helix.scientific_image_evidence_sidecar.v1",
        source_kind: "pdf_page_render",
        page: 5,
        evidence_depth: "exact_row_promoted",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    };
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      response_type: "final_answer",
      final_status: "completed",
      selected_final_answer: answerText,
      final_answer_source: "agent_provider_terminal_candidate",
      terminal_artifact_kind: "agent_provider_terminal_candidate",
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        source_target: "agent_provider_gateway_turn",
        allowed_terminal_artifact_kinds: ["agent_provider_terminal_candidate", "typed_failure"],
        assistant_answer: false,
        raw_content_included: false,
      },
      route_evidence_authority: {
        schema: "helix.route_evidence_authority.v1",
        turn_id: turnId,
        candidate_tools: [
          {
            capability_id: "moral-graph.reflect_context",
            family: "moral_graph_reflection",
            reason: "prompt_requested_moral_graph",
          },
          {
            capability_id: "visual_analysis.inspect_image_region",
            family: "image_lens",
            reason: "ambient_prior_sidecar_not_requested",
          },
        ],
        admitted_tools: [
          {
            capability_id: "moral-graph.reflect_context",
            family: "moral_graph_reflection",
            reason: "current_route_admitted_moral_graph",
            admission_ref: "route:test:moral_graph",
          },
        ],
        rejected_tools: [
          {
            capability_id: "visual_analysis.inspect_image_region",
            family: "image_lens",
            reason: "ambient_prior_sidecar_not_admitted",
          },
        ],
        supporting_evidence_refs: ["ask:test:moral_graph_observation"],
        allowed_terminal_artifact_kinds: ["agent_provider_terminal_candidate", "typed_failure"],
        forbidden_terminal_artifact_kinds: ["image_lens_observation_report", "scientific_image_evidence_sidecar"],
        required_terminal_kind: "agent_provider_terminal_candidate",
        terminal_product_allowed: true,
        current_turn_only: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      current_turn_artifact_ledger: [staleSidecar],
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: [staleSidecar],
    });

    expect(result.selected_terminal_artifact_kind).toBe("agent_provider_terminal_candidate");
    expect(payload.selected_final_answer).toBe(answerText);
    expect(String(payload.selected_final_answer)).not.toContain("scientific_image_evidence_sidecar_lookup_failed");
    expect(String(payload.selected_final_answer)).not.toContain("Image Lens");
    expect(payload.terminal_error_code).toBeFalsy();
  });

  it("does not surface success-looking drafts for failed mutating capability rails", () => {
    const turnId = "ask:test:goal-session-not-admitted";
    const successLookingText =
      "Started or updated workstation goal session stage_play_goal:abc123.";
    const artifacts = [
      {
        artifact_id: `${turnId}:final_answer_draft`,
        kind: "final_answer_draft",
        payload: {
          schema: "helix.final_answer_draft.v1",
          turn_id: turnId,
          text: successLookingText,
          answer_text: successLookingText,
          assistant_answer: false,
          raw_content_included: false,
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      selected_final_answer: successLookingText,
      terminal_artifact_kind: "model_synthesized_answer",
      final_answer_source: "final_answer_draft",
      canonical_goal_frame: {
        goal_kind: "workstation_goal_context",
        required_terminal_kind: "workstation_tool_evaluation",
      },
      capability_plan: {
        schema: "helix.capability_plan.v1",
        turn_id: turnId,
        capability_family: "live_environment",
        requested_action: "live_env.start_agent_goal_session",
        requested_capability: "live_env.start_agent_goal_session",
        selected_capability: "live_env.start_agent_goal_session",
        mutating: true,
        operator_command_required: true,
        operator_command_present: false,
        source_target: "live_environment",
        goal_kind: "workstation_goal_context",
        required_terminal_kind: "workstation_tool_evaluation",
        admission_status: "needs_user_confirmation",
        rejection_reason: "mutating_capability_requires_operator_command",
        assistant_answer: false,
        raw_content_included: false,
      },
      capability_lifecycle_ledger: {
        schema: "helix.capability_lifecycle_ledger.v1",
        turn_id: turnId,
        ok: false,
        failure_codes: ["mutating_capability_without_operator_command"],
        assistant_answer: false,
        raw_content_included: false,
      },
      current_turn_artifact_ledger: artifacts,
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("typed_failure");
    expect(payload.terminal_artifact_kind).toBe("typed_failure");
    expect(payload.final_answer_source).toBe("typed_failure");
    expect(payload.terminal_error_code).toBe("mutating_capability_requires_operator_command");
    expect(String(payload.selected_final_answer)).not.toContain("Started or updated workstation goal session");
    expect(result.rejected_candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "model_synthesized_answer",
          reason: "capability_lifecycle_failed",
        }),
      ]),
    );
  });

  it("preserves specific typed-failure rail code when projection guard reconciles stale visible kind", () => {
    const turnId = "ask:test:typed-failure-projection-guard-specific-rail";
    const failureText =
      "I could not produce a terminal answer because the requested tool rail did not complete. Cause: terminal_not_materialized.";
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      ok: false,
      final_status: "final_failure",
      terminal_artifact_kind: "doc_location_matches",
      final_answer_source: "typed_failure",
      terminal_error_code: "terminal_not_materialized",
      terminal_failure_text: failureText,
      selected_final_answer: "Locations:\n- stale visible doc projection",
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        turn_id: turnId,
        terminal_artifact_kind: "doc_location_matches",
        concise_text: "Locations:\n- stale visible doc projection",
      },
      typed_failure: {
        schema: "helix.typed_failure.v1",
        error_code: "terminal_not_materialized",
        text: failureText,
        answer_text: failureText,
        assistant_answer: false,
        raw_content_included: false,
      },
    };

    const result = applyTerminalProjectionKindGuard(payload, {
      schema: "helix.terminal_authority_single_writer_result.v1",
      artifactId: "terminal_authority_single_writer",
      schemaVersion: "helix.terminal_authority_single_writer.v1",
      turn_id: turnId,
      selectedArtifactKind: "typed_failure",
      selectedArtifactRef: "typed_failure:specific",
      selected_terminal_artifact_kind: "typed_failure",
      selected_terminal_artifact_ref: "typed_failure:specific",
      visible_text: failureText,
      assistant_answer: false,
      source: "typed_failure",
      rejected_candidates: [],
      writes: {
        payload_text: failureText,
        payload_answer: failureText,
        payload_assistant_answer: failureText,
        payload_selected_final_answer: failureText,
        terminal_presentation_concise_text: failureText,
        debug_selected_final_answer: failureText,
      },
      wroteVisibleFields: [],
      forbiddenPreAuthorityVisibleFields: [],
      audit: {
        artifactId: "terminal_authority_single_writer",
        schemaVersion: "helix.terminal_authority_single_writer.v1",
        selectedArtifactKind: "typed_failure",
        selectedArtifactRef: "typed_failure:specific",
        rejectedCandidates: [],
        wroteVisibleFields: [],
        forbiddenPreAuthorityVisibleFields: [],
      },
      integrity: {
        single_writer_applied: true,
        visible_matches_selected_artifact: false,
        visible_matches_draft: false,
        stale_failure_visible: false,
        receipt_visible_as_answer: false,
        post_tool_model_step_satisfied: true,
        legacy_terminal_candidate_count: 0,
        forbidden_terminal_candidate_count: 0,
        payload_mirror_written_after_terminal_selection: true,
      },
    });

    expect(result.selected_terminal_artifact_kind).toBe("typed_failure");
    expect(result.visible_text).toBe(failureText);
    expect(payload.terminal_error_code).toBe("terminal_not_materialized");
    expect((payload.typed_failure as Record<string, unknown>).error_code).toBe("terminal_not_materialized");
    expect(payload.selected_final_answer).toBe(failureText);
    expect((payload.terminal_presentation as Record<string, unknown>).terminal_artifact_kind).toBe("typed_failure");
  });

  it("uses tool rail failure code when typed failure only carries projection mismatch", () => {
    const turnId = "ask:test:typed-failure-projection-guard-rail-fallback";
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      ok: false,
      final_status: "final_failure",
      terminal_artifact_kind: "workspace_action_receipt",
      final_answer_source: "typed_failure",
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        turn_id: turnId,
        terminal_artifact_kind: "workspace_action_receipt",
        concise_text: "Opened docs viewer.",
      },
      typed_failure: {
        schema: "helix.typed_failure.v1",
        error_code: "terminal_projection_mismatch",
        text: "I could not produce a terminal answer because terminal authority and visible projection selected different artifacts.",
        answer_text:
          "I could not produce a terminal answer because terminal authority and visible projection selected different artifacts.",
        assistant_answer: false,
        raw_content_included: false,
      },
      tool_turn_chain_audit: {
        schema: "helix.tool_turn_chain_audit.v1",
        rail_status: "fail_closed",
        rail_failure_code: "observation_missing",
        first_broken_rail: "observation_artifact",
        repair_target: "observation_materializer",
      },
    };

    applyTerminalProjectionKindGuard(payload, {
      schema: "helix.terminal_authority_single_writer_result.v1",
      artifactId: "terminal_authority_single_writer",
      schemaVersion: "helix.terminal_authority_single_writer.v1",
      turn_id: turnId,
      selectedArtifactKind: "typed_failure",
      selectedArtifactRef: "typed_failure:rail",
      selected_terminal_artifact_kind: "typed_failure",
      selected_terminal_artifact_ref: "typed_failure:rail",
      visible_text:
        "I could not produce a terminal answer because terminal authority and visible projection selected different artifacts.",
      assistant_answer: false,
      source: "typed_failure",
      rejected_candidates: [],
      writes: {
        payload_text: "",
        payload_answer: "",
        payload_assistant_answer: "",
        payload_selected_final_answer: "",
        terminal_presentation_concise_text: "",
        debug_selected_final_answer: "",
      },
      wroteVisibleFields: [],
      forbiddenPreAuthorityVisibleFields: [],
      audit: {
        artifactId: "terminal_authority_single_writer",
        schemaVersion: "helix.terminal_authority_single_writer.v1",
        selectedArtifactKind: "typed_failure",
        selectedArtifactRef: "typed_failure:rail",
        rejectedCandidates: [],
        wroteVisibleFields: [],
        forbiddenPreAuthorityVisibleFields: [],
      },
      integrity: {
        single_writer_applied: true,
        visible_matches_selected_artifact: false,
        visible_matches_draft: false,
        stale_failure_visible: false,
        receipt_visible_as_answer: false,
        post_tool_model_step_satisfied: true,
        legacy_terminal_candidate_count: 0,
        forbidden_terminal_candidate_count: 0,
        payload_mirror_written_after_terminal_selection: true,
      },
    });

    expect(payload.terminal_error_code).toBe("observation_missing");
    expect((payload.typed_failure as Record<string, unknown>).error_code).toBe("observation_missing");
    expect(payload.selected_final_answer).toMatch(/observation_missing/);
    expect((payload.terminal_presentation as Record<string, unknown>).terminal_artifact_kind).toBe("typed_failure");
  });

  it("does not mirror processed live-source mail summaries as typed-failure answers", () => {
    const turnId = "ask:test:live-source-summary-typed-failure";
    const contentSummary =
      'The processed visual mail shows stage_play_live_source_mail:4bef8bfa294c18803d hud: {"health_hearts":"10"}; stage_play_live_source_mail:4bef8bfa294c18803d hotbar: {"selected_slot":"1"}.';
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      selected_final_answer: contentSummary,
      terminal_failure_text: contentSummary,
      final_answer_source: "typed_failure",
      terminal_artifact_kind: "typed_failure",
      terminal_error_code: "typed_failure",
      canonical_goal_frame: {
        goal_kind: "live_source_processed_mail_interpretation",
        required_terminal_kind: "model_synthesized_answer",
      },
      source_target_intent: {
        target_source: "live_source_mailbox",
        strength: "hard",
        must_enter_backend_ask: true,
      },
      resolved_turn_summary: {
        final_status: "final_failure",
        resolved_route_label: "live_source_processed_mail_interpretation / model_synthesized_answer",
        terminal_artifact_kind: "typed_failure",
        terminal_error_code: "typed_failure",
      },
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        thread_id: "thread:test",
        turn_id: turnId,
        route: "dispatch:observe",
        terminal_kind: "failure",
        final_answer_source: "typed_failure",
        terminal_artifact_kind: "typed_failure",
        terminal_text_preview: contentSummary,
        terminal_text_hash: "stale",
        server_authoritative: true,
      },
      typed_failure: {
        schema: "helix.typed_failure.v1",
        error_code: "typed_failure",
        message: contentSummary,
        text: contentSummary,
        answer_text: contentSummary,
        assistant_answer: false,
        raw_content_included: false,
      },
    };

    expect(syncHelixTypedFailureAuthorityPublicMirrors(payload)).toBe(true);

    expect(payload.terminal_error_code).toBe("post_tool_model_step_missing");
    expect(payload.selected_final_answer).toBe(
      "I could not complete this live-source mailbox turn because processed mail was observed, but no valid model-synthesized answer passed terminal authority.",
    );
    expect(payload.selected_final_answer).not.toBe(contentSummary);
    expect(payload.typed_failure).toMatchObject({
      error_code: "post_tool_model_step_missing",
      message: payload.selected_final_answer,
      text: payload.selected_final_answer,
      answer_text: payload.selected_final_answer,
    });
    expect(payload.terminal_answer_authority).toMatchObject({
      terminal_kind: "failure",
      final_answer_source: "typed_failure",
      terminal_artifact_kind: "typed_failure",
      terminal_text_preview: payload.selected_final_answer,
    });
    expect((payload.terminal_answer_authority as Record<string, unknown>).terminal_text_hash).not.toBe("stale");
    expect(payload.resolved_turn_summary).toMatchObject({
      final_status: "final_failure",
      terminal_artifact_kind: "typed_failure",
      terminal_error_code: "post_tool_model_step_missing",
      final_answer_source: "typed_failure",
    });
  });

  it("keeps a full scholarly provider-failure explanation when authority stores only a preview", () => {
    const fullFailureText = [
      "The scholarly lookup did not return any usable, topic-relevant papers.",
      "It failed with `semantic_scholar_http_429`; its fallback candidates were rejected as weak matches.",
      "Therefore I cannot provide paper titles, identifiers, or access details from this observation without inventing results. No full text was fetched and no parseability was inferred.",
    ].join("\n\n");
    expect(fullFailureText.length).toBeGreaterThan(240);
    const payload: Record<string, unknown> = {
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
      terminal_error_code: "semantic_scholar_http_429",
      terminal_failure_text: fullFailureText,
      selected_final_answer: fullFailureText,
      typed_failure: {
        schema: "helix.typed_failure.v1",
        error_code: "semantic_scholar_http_429",
        message: fullFailureText,
        text: fullFailureText,
        answer_text: fullFailureText,
      },
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        terminal_kind: "failure",
        terminal_artifact_kind: "typed_failure",
        final_answer_source: "typed_failure",
        terminal_text_preview: fullFailureText.slice(0, 240),
        server_authoritative: true,
      },
      resolved_turn_summary: { final_status: "final_answer" },
      terminal_presentation: {
        terminal_artifact_kind: "typed_failure",
        concise_text: fullFailureText.slice(0, 240),
      },
    };

    expect(syncHelixTypedFailureAuthorityPublicMirrors(payload)).toBe(true);
    expect(payload).toMatchObject({
      ok: false,
      response_type: "final_failure",
      final_status: "final_failure",
      terminal_error_code: "semantic_scholar_http_429",
      selected_final_answer: fullFailureText,
      terminal_failure_text: fullFailureText,
      typed_failure: {
        message: fullFailureText,
        text: fullFailureText,
        answer_text: fullFailureText,
      },
      terminal_presentation: { concise_text: fullFailureText },
    });
    expect((payload.terminal_answer_authority as Record<string, unknown>).terminal_text_preview)
      .toBe(fullFailureText.slice(0, 240));
  });

  it("blocks a metadata terminal when a required scholarly full-text subgoal was dropped", () => {
    const turnId = "ask:test:scholarly-full-text-subgoal-dropped";
    const metadataText = "One scholarly metadata record was found, but no full text was fetched.";
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      response_type: "final_answer",
      final_status: "completed",
      selected_final_answer: metadataText,
      final_answer_source: "scholarly_research_answer",
      terminal_artifact_kind: "scholarly_research_answer",
      compound_prompt_coverage_gate: {
        schema: "helix.compound_prompt_coverage_gate.v1",
        decision: "FAIL_CLOSED",
        missing_required_capabilities: ["scholarly-research.fetch_full_text"],
      },
      compound_subgoal_rail_statuses: [
        {
          subgoal_id: "scholarly_research_workflow:scholarly_evidence",
          requested_capability: "scholarly-research.lookup_papers",
          executed_capability: "scholarly-research.lookup_papers",
          satisfaction: "satisfied",
          rail_status: "complete",
          observation_ref: `${turnId}:scholarly_lookup`,
        },
        {
          subgoal_id: "scholarly_research_workflow:scholarly_full_text",
          requested_capability: "scholarly-research.fetch_full_text",
          satisfaction: "blocked",
          rail_status: "blocked",
          rail_failure_code: "compound_subgoal_dropped",
          first_broken_rail: "capability_execution",
          repair_target: "agent_step_selection",
        },
      ],
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        source_target: "scholarly_research",
        allowed_terminal_artifact_kinds: ["scholarly_research_answer", "typed_failure"],
        required_terminal_artifact_kind: "scholarly_research_answer",
      },
      canonical_goal_frame: {
        schema: "helix.canonical_goal_frame.v1",
        goal_kind: "scholarly_full_text",
        required_terminal_kind: "scholarly_research_answer",
      },
      current_turn_artifact_ledger: [],
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: [],
    });

    expect(result.selected_terminal_artifact_kind).toBe("typed_failure");
    expect(result.visible_text).toContain("scholarly-research.fetch_full_text was dropped before execution");
    expect(payload.terminal_error_code).toBe("compound_subgoal_dropped");
    expect(payload.first_incomplete_compound_subgoal_id)
      .toBe("scholarly_research_workflow:scholarly_full_text");
    expect(payload.selected_final_answer).not.toBe(metadataText);
  });

  it("repairs stale failure authority when capability help passed terminal arbitration", () => {
    const helpText = "The scholarly lookup selects candidates first; Image Lens is used only for visual extraction.";
    const payload: Record<string, unknown> = {
      selected_final_answer: helpText,
      answer: helpText,
      final_answer_contract_pass: true,
      final_answer_contract_family: "capability_help",
      canonical_goal_frame: { required_terminal_kind: "capability_help_summary" },
      solver_controller_decision: {
        decision: "allow_terminal",
        selected_terminal_artifact_kind: "capability_help_summary",
      },
      terminal_error_code: "tool_execution_rejected",
      typed_failure: { error_code: "tool_execution_rejected" },
      terminal_answer_authority: {
        terminal_kind: "failure",
        final_answer_source: "typed_failure",
        terminal_artifact_kind: "typed_failure",
        server_authoritative: true,
      },
      resolved_turn_summary: { final_status: "final_failure" },
      terminal_presentation: { terminal_artifact_kind: "typed_failure" },
    };

    expect(syncHelixTypedFailureAuthorityPublicMirrors(payload)).toBe(true);
    expect(payload).toMatchObject({
      ok: true,
      final_status: "final_answer",
      terminal_artifact_kind: "capability_help_summary",
      final_answer_source: "capability_help_summary",
      selected_final_answer: helpText,
    });
    expect(payload.terminal_error_code).toBeUndefined();
    expect(payload.typed_failure).toBeUndefined();
  });

  it("refreshes a stale 240-character failure preview after capability help satisfies its terminal contract", () => {
    const turnId = "ask:test:capability-help-stale-terminal-writer";
    const answerText = [
      "The research-paper workflow first searches and ranks candidate papers; it does not assume every candidate is parseable.",
      "- scholarly-research.lookup_papers discovers candidates. scholarly-research.fetch_full_text checks for usable full text.",
      "- Image Lens is used selectively when scanned text, equations, figures, or tables require visual inspection.",
    ].join("\n");
    expect(answerText.length).toBeGreaterThan(240);

    const registryArtifact = {
      artifact_id: `${turnId}:capability_registry`,
      kind: "capability_registry",
      payload: {
        schema: "helix.capability_registry.v1",
        assistant_answer: false,
        terminal_eligible: false,
      },
    };
    const summaryArtifact = {
      artifact_id: `${turnId}:capability_help_summary`,
      kind: "capability_help_summary",
      payload: {
        schema: "helix.capability_help_summary.v1",
        kind: "capability_help_summary",
        text: answerText,
        support_refs: [registryArtifact.artifact_id],
        terminal_eligible: true,
        assistant_answer: false,
      },
    };
    const artifacts = [registryArtifact, summaryArtifact];
    const clippedFailure = answerText.slice(0, 240);
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      canonical_goal_frame: {
        goal_kind: "capability_help",
        required_terminal_kind: "capability_help_summary",
      },
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        allowed_terminal_artifact_kinds: ["capability_help_summary", "typed_failure"],
        forbidden_terminal_artifact_kinds: ["direct_answer_text", "model_synthesized_answer"],
      },
      goal_satisfaction_evaluation: {
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
      tool_call_admission_decision: {
        admitted_capability: "helix_ask.inspect_capability_catalog",
        selected_capability: "helix_ask.inspect_capability_catalog",
      },
      capability_plan: {
        selected_capability: "helix_ask.inspect_capability_catalog",
      },
      agent_step_decision: {
        chosen_capability: "model.direct_answer",
        next_step: "answer",
        decision_timing: "post_observation",
        decision_authority: "llm",
      },
      agent_runtime_loop: {
        executed_tool_call_count: 0,
        iterations: [{
          chosen_capability: "model.direct_answer",
          next_step: "answer",
          decision_timing: "post_observation",
          decision_authority: "llm",
          observation_role: "model_answer_draft",
        }],
      },
      satisfaction_report: {
        satisfied: true,
        terminal_artifact_kind: "capability_help_summary",
      },
      current_turn_artifact_ledger: artifacts,
      terminal_error_code: "terminal_not_materialized",
      selected_final_answer: clippedFailure,
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
      typed_failure: {
        error_code: "terminal_not_materialized",
        message: answerText,
        text: clippedFailure,
      },
      terminal_authority_single_writer: {
        selected_terminal_artifact_kind: "typed_failure",
        visible_text: clippedFailure,
      },
      tool_turn_chain_audit: {
        rail_status: "fail_closed",
        rail_failure_code: "terminal_not_materialized",
        first_broken_rail: "terminal_materialization",
        repair_target: "terminal_materializer",
        selected_capability: "helix_ask.inspect_capability_catalog",
        executed_capability: "helix_ask.inspect_capability_catalog",
      },
    };

    expect(shouldRefreshHelixTerminalAuthorityAfterSatisfiedGoal({ payload, artifactLedger: artifacts })).toBe(true);

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("capability_help_summary");
    expect(result.visible_text).toBe(answerText);
    expect(payload).toMatchObject({
      ok: true,
      final_status: "final_answer",
      terminal_artifact_kind: "capability_help_summary",
      final_answer_source: "capability_help_summary",
      selected_final_answer: answerText,
      terminal_presentation: {
        terminal_artifact_kind: "capability_help_summary",
        concise_text: answerText,
      },
    });
    expect(payload.terminal_error_code).toBeUndefined();
    expect(payload.typed_failure).toBeUndefined();
  });

  it("does not refresh a stale writer when the required terminal artifact is missing", () => {
    const payload: Record<string, unknown> = {
      canonical_goal_frame: {
        goal_kind: "tool_request",
        required_terminal_kind: "workstation_tool_evaluation",
      },
      route_product_contract: {
        allowed_terminal_artifact_kinds: ["workstation_tool_evaluation", "typed_failure"],
      },
      goal_satisfaction_evaluation: {
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
      terminal_error_code: "terminal_not_materialized",
      terminal_authority_single_writer: {
        selected_terminal_artifact_kind: "typed_failure",
      },
    };

    expect(shouldRefreshHelixTerminalAuthorityAfterSatisfiedGoal({ payload, artifactLedger: [] })).toBe(false);
  });

  it("selects a post-observation final draft over stale workspace failure mirrors", () => {
    const turnId = "ask:test:single-writer-open";
    const artifacts = [
      {
        artifact_id: `${turnId}:receipt`,
        kind: "workspace_action_receipt",
        payload: {
          status: "completed",
          label: "Docs & Papers",
          message: "Opening panel: Docs & Papers.",
        },
      },
      makePostToolObservation(turnId),
      {
        artifact_id: `${turnId}:final_answer_draft`,
        kind: "final_answer_draft",
        payload: {
          schema: "helix.final_answer_draft.v1",
          text: "docs-viewer has been successfully opened.",
          authority: "llm_post_observation_composer",
        },
      },
      {
        artifact_id: `${turnId}:obs`,
        kind: "agent_step_observation_packet",
        payload: {
          schema: "helix.agent_step_observation_packet.v1",
          turn_id: turnId,
          status: "succeeded",
          terminal_eligible: false,
          post_tool_model_step_required: false,
          capability_id: "workstation-notes.create_note",
          capability_key: "workstation-notes.create_note",
          tool_name: "workstation-notes.create_note",
          action: {
            panel_id: "workstation-notes",
            action_id: "create_note",
          },
          produced_artifact_refs: [`${turnId}:note_update_receipt`],
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      current_turn_artifact_ledger: artifacts,
      selected_final_answer: "Failed to execute docs-viewer.open (workspace_step_failed).",
      answer: "Failed to execute docs-viewer.open (workspace_step_failed).",
      text: "Failed to execute docs-viewer.open (workspace_step_failed).",
      terminal_artifact_kind: "workspace_action_receipt",
      final_answer_source: "legacy_workspace_failure",
      debug: {
        selected_final_answer: "Failed to execute docs-viewer.open (workspace_step_failed).",
      },
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("model_synthesized_answer");
    expect(result.artifactId).toBe("terminal_authority_single_writer");
    expect(result.schemaVersion).toBe("helix.terminal_authority_single_writer.v1");
    expect(result.selectedArtifactKind).toBe("model_synthesized_answer");
    expect(result.audit).toMatchObject({
      artifactId: "terminal_authority_single_writer",
      schemaVersion: "helix.terminal_authority_single_writer.v1",
      selectedArtifactKind: "model_synthesized_answer",
      wroteVisibleFields: expect.arrayContaining([
        "payload.text",
        "payload.answer",
        "payload.assistant_answer",
        "payload.selected_final_answer",
        "terminal_presentation.concise_text",
      ]),
    });
    expect(result.selected_terminal_artifact_ref).toBe(`${turnId}:model_synthesized_answer:from_final_answer_draft`);
    expect(result.visible_text).toBe("docs-viewer has been successfully opened.");
    expect(result.integrity.visible_matches_draft).toBe(true);
    expect(result.integrity.stale_failure_visible).toBe(false);
    expect(result.integrity.receipt_visible_as_answer).toBe(false);
    expect(result.rejected_candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "workspace_action_receipt", reason: "receipt_or_projection" }),
        expect.objectContaining({ kind: "legacy_workspace_failure", reason: "stale_failure_candidate" }),
      ]),
    );
    expect(payload.selected_final_answer).toBe("docs-viewer has been successfully opened.");
    expect((payload.terminal_presentation as Record<string, unknown>).concise_text).toBe("docs-viewer has been successfully opened.");
    expect((payload.debug as Record<string, unknown>).selected_final_answer).toBe("docs-viewer has been successfully opened.");
  });

  it("selects post-tool synthesized answers over stale typed failures after internal tool success", () => {
    const turnId = "ask:test:internal-success-visible-failure";
    const staleFailureText = "I am unable to provide context because no observations are available.";
    const synthesizedText = "The tool succeeded, the observation was re-entered, and the answer was synthesized from that evidence.";
    const artifacts = [
      {
        artifact_id: `${turnId}:receipt`,
        kind: "workspace_action_receipt",
        payload: {
          schema: "helix.workspace_action_receipt.v1",
          status: "completed",
          message: "Tool receipt succeeded.",
          assistant_answer: false,
          terminal_eligible: false,
        },
      },
      makePostToolObservation(turnId),
      {
        artifact_id: `${turnId}:stale_typed_failure`,
        kind: "typed_failure",
        payload: {
          schema: "helix.typed_failure.v1",
          error_code: "stale_model_only_fallback",
          text: staleFailureText,
          assistant_answer: false,
          raw_content_included: false,
        },
      },
      {
        artifact_id: `${turnId}:final_answer_draft`,
        kind: "final_answer_draft",
        payload: {
          schema: "helix.final_answer_draft.v1",
          text: synthesizedText,
          authority: "llm_post_observation_composer",
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        allowed_terminal_artifact_kinds: ["model_synthesized_answer", "typed_failure"],
        forbidden_terminal_artifact_kinds: ["workspace_action_receipt", "agent_step_observation_packet"],
        assistant_answer: false,
        raw_content_included: false,
      },
      canonical_goal_frame: {
        goal_kind: "post_tool_answer",
        required_terminal_kind: "model_synthesized_answer",
      },
      current_turn_artifact_ledger: artifacts,
      selected_final_answer: staleFailureText,
      answer: staleFailureText,
      text: staleFailureText,
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
      goal_satisfaction_evaluation: {
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
      agent_runtime_loop: {
        schema: "helix.agent_step_loop.v1",
        iterations: [
          {
            iteration: 1,
            next_step: "next_action",
            chosen_capability: "workstation-notes.create_note",
            decision_authority: "helix_policy",
            observed_artifact_refs: [`${turnId}:obs`, `${turnId}:note_update_receipt`],
          },
          {
            iteration: 2,
            next_step: "answer",
            chosen_capability: "workstation-notes.create_note",
            decision_authority: "client_receipt",
            observed_artifact_refs: [`${turnId}:note_update_receipt`],
          },
        ],
      },
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("model_synthesized_answer");
    expect(result.source).toBe("final_answer_draft");
    expect(result.selected_terminal_artifact_ref).not.toMatch(/^typed_failure:/);
    expect(result.audit?.selectedArtifactRef).not.toMatch(/^typed_failure:/);
    expect(result.visible_text).toBe(synthesizedText);
    expect(result.visible_text).not.toBe(staleFailureText);
    expect(result.rejected_candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "typed_failure",
        source: "typed_failure",
        reason: "stale_model_only_after_observation",
      }),
      expect.objectContaining({
        kind: "workspace_action_receipt",
        reason: "receipt_or_projection",
      }),
    ]));
    expect(payload.terminal_artifact_kind).toBe("model_synthesized_answer");
    expect(payload.final_answer_source).toBe("final_answer_draft");
    expect(payload.selected_final_answer).toBe(synthesizedText);
    expect((payload.terminal_presentation as Record<string, unknown>).concise_text).toBe(synthesizedText);
    expect(payload.ask_turn_procedure_trace).toMatchObject({
      schema: "helix.ask_turn_procedure_trace.v1",
      intent_class: "post_tool_answer",
      evidence_reentry_status: "reentered",
      allowed_terminal_products: expect.arrayContaining(["model_synthesized_answer"]),
      selected_terminal_product: expect.objectContaining({
        kind: "model_synthesized_answer",
        allowed_by_route: true,
      }),
      visible_answer_source: "final_answer_draft",
      failure_rail: null,
    });
  });

  it("does not select stale workstation artifacts when a contextual tool mention is suppressed", () => {
    const turnId = "ask:test:suppressed-tool-direct-answer";
    const directText = "Calculator receipts are observations because they record evidence, while terminal answers are selected after solver authority.";
    const staleToolText = "Calculator verification plan completed.";
    const artifacts = [
      {
        artifact_id: `${turnId}:direct`,
        kind: "direct_answer_text",
        payload: {
          schema: "helix.direct_answer_text.v1",
          text: directText,
          answer_text: directText,
          assistant_answer: false,
          raw_content_included: false,
        },
      },
      {
        artifact_id: `${turnId}:workstation_eval`,
        kind: "workstation_tool_evaluation",
        payload: {
          schema: "helix.workstation_tool_evaluation.v1",
          evaluation_id: `${turnId}:workstation_eval`,
          supports_goal: true,
          text: staleToolText,
          answer_text: staleToolText,
          assistant_answer: false,
          raw_content_included: false,
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      current_turn_artifact_ledger: artifacts,
      committed_ask_route: {
        schema: "helix.committed_ask_route.v1",
        turn_id: turnId,
        commit_id: "commit:test",
        prompt_hash: "hash:test",
        committed_at_stage: "post_prompt_source_arbitration",
        prompt_intent: {
          primary_intent_kind: "content_question",
          secondary_intent_kinds: [],
        },
        route: {
          selected_route: "model_only_concept",
          source_target: "model_only",
          target_kind: "general_background",
          strength: "hard",
          route_reason: "contextual_tool_reference_suppressed",
          stale_metadata_policy: "ignore_unless_matches_commit",
        },
        canonical_goal: {
          goal_kind: "model_only_concept",
          required_terminal_kind: "direct_answer_text",
          allowed_terminal_artifact_kinds: ["direct_answer_text", "typed_failure"],
          forbidden_terminal_artifact_kinds: ["workstation_tool_evaluation"],
        },
        assistant_answer: false,
        raw_content_included: false,
      },
      canonical_goal_frame: {
        goal_kind: "model_only_concept",
        answer_scope: "model_only",
        required_terminal_kind: "direct_answer_text",
      },
      capability_plan: {
        capability_contract_arbitration: {
          contract_state: "suppressed_contextual_reference",
        },
        tool_admission_suppressed: true,
      },
      tool_call_admission_decision: {
        tool_admission_suppressed: true,
      },
      codex_parity_agent_spine_rail_table: {
        schema: "helix.codex_parity_agent_spine_rail_table.v1",
        requested_capability: "model_only",
        selected_capability: "model_only",
        admitted_capability: "model_only",
        reentry_status: "no_observation",
        reentry_proven: false,
      },
      goal_satisfaction_evaluation: {
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
        terminal_contract: {
          goal_kind: "model_only_concept",
          required_terminal_kinds: ["direct_answer_text"],
        },
      },
      selected_final_answer: staleToolText,
      terminal_artifact_kind: "workstation_tool_evaluation",
      final_answer_source: "workstation_tool_evaluation",
    };
    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("direct_answer_text");
    expect(result.visible_text).toBe(directText);
    expect(payload.terminal_artifact_kind).toBe("direct_answer_text");
    expect(payload.final_answer_source).toBe("model_direct_answer");
    expect(payload.selected_final_answer).toBe(directText);
    expect(payload.ask_turn_procedure_trace).toMatchObject({
      schema: "helix.ask_turn_procedure_trace.v1",
      intent_class: "model_only_concept",
      evidence_reentry_status: "no_observation",
      allowed_terminal_products: expect.arrayContaining(["direct_answer_text"]),
      selected_terminal_product: expect.objectContaining({
        kind: "direct_answer_text",
        allowed_by_route: true,
      }),
      visible_answer_source: "model_direct_answer",
      failure_rail: null,
    });
  });

  it("keeps quoted and negated internet-search tool identifiers model-only at terminal authority", () => {
    const turnId = "ask:test:suppressed-internet-search-tool-name";
    const directText =
      "`internet-search.search_web` is a namespaced identifier: `internet-search` names the tool family and `search_web` names the operation.";
    const staleSearchText =
      "I cannot claim the requested workstation tool or UI action ran because internet-search.search_web failed: tavily_requires_TAVILY_API_KEY.";
    const artifacts = [
      {
        artifact_id: `${turnId}:direct`,
        kind: "direct_answer_text",
        payload: {
          schema: "helix.direct_answer_text.v1",
          text: directText,
          answer_text: directText,
          assistant_answer: false,
          raw_content_included: false,
        },
      },
      {
        artifact_id: `${turnId}:stale_internet_search`,
        kind: "internet_search_answer",
        payload: {
          schema: "helix.internet_search_answer.v1",
          text: staleSearchText,
          answer_text: staleSearchText,
          assistant_answer: false,
          raw_content_included: false,
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      active_prompt:
        "Explain the literal phrase `internet-search.search_web` as a software tool name. Do not browse, search, retrieve web evidence, or call tools.",
      current_turn_artifact_ledger: artifacts,
      committed_ask_route: {
        schema: "helix.committed_ask_route.v1",
        turn_id: turnId,
        commit_id: "commit:test:internet-search-suppressed",
        prompt_hash: "hash:test:internet-search-suppressed",
        committed_at_stage: "post_prompt_source_arbitration",
        prompt_intent: {
          primary_intent_kind: "content_question",
          secondary_intent_kinds: [],
        },
        route: {
          selected_route: "model_only_concept",
          source_target: "model_only",
          target_kind: "general_background",
          strength: "hard",
          route_reason: "quoted_and_negated_tool_identifier_suppressed",
          stale_metadata_policy: "ignore_unless_matches_commit",
        },
        canonical_goal: {
          goal_kind: "model_only_concept",
          requested_capability: null,
          required_terminal_kind: "direct_answer_text",
          allowed_terminal_artifact_kinds: ["direct_answer_text", "typed_failure"],
          forbidden_terminal_artifact_kinds: ["internet_search_answer", "workstation_tool_evaluation"],
        },
        assistant_answer: false,
        raw_content_included: false,
      },
      canonical_goal_frame: {
        goal_kind: "model_only_concept",
        answer_scope: "model_only",
        required_terminal_kind: "direct_answer_text",
      },
      tool_call_admission_decision: {
        requested_capability: "internet-search.search_web",
        requested_capability_source: "quoted_or_negated_tool_identifier",
        tool_admission_suppressed: true,
      },
      goal_satisfaction_evaluation: {
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
        terminal_contract: {
          goal_kind: "model_only_concept",
          required_terminal_kinds: ["direct_answer_text"],
        },
      },
      selected_final_answer: staleSearchText,
      terminal_artifact_kind: "internet_search_answer",
      final_answer_source: "internet_search_answer",
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("direct_answer_text");
    expect(result.visible_text).toBe(directText);
    expect(payload.terminal_artifact_kind).toBe("direct_answer_text");
    expect(payload.final_answer_source).toBe("model_direct_answer");
    expect(payload.selected_final_answer).toBe(directText);
    expect(String(payload.selected_final_answer)).not.toMatch(/tavily|retrieval|grounded evidence/i);
    expect(payload.ask_turn_procedure_trace).toMatchObject({
      schema: "helix.ask_turn_procedure_trace.v1",
      intent_class: "model_only_concept",
      evidence_reentry_status: "reentered",
      allowed_terminal_products: expect.arrayContaining(["direct_answer_text"]),
      selected_terminal_product: expect.objectContaining({
        kind: "direct_answer_text",
        allowed_by_route: true,
      }),
      visible_answer_source: "model_direct_answer",
      failure_rail: null,
    });
  });

  it.each([
    {
      label: "missing committed route",
      payloadPatch: {},
      expectedFailureRail: "route_not_selected",
    },
    {
      label: "tool selected but not admitted",
      payloadPatch: {
        route_product_contract: {
          schema: "helix.route_product_contract.v1",
          allowed_terminal_artifact_kinds: ["typed_failure"],
          required_terminal_kind: "model_synthesized_answer",
        },
        canonical_goal_frame: {
          goal_kind: "tool_request",
          required_terminal_kind: "model_synthesized_answer",
        },
        tool_call_admission_decision: {
          requested_capability: "internet-search.search_web",
          selected_capability: "internet-search.search_web",
        },
      },
      expectedFailureRail: "tool_not_admitted",
    },
    {
      label: "observation missing",
      payloadPatch: {
        route_product_contract: {
          schema: "helix.route_product_contract.v1",
          allowed_terminal_artifact_kinds: ["typed_failure"],
          required_terminal_kind: "model_synthesized_answer",
        },
        canonical_goal_frame: {
          goal_kind: "tool_request",
          required_terminal_kind: "model_synthesized_answer",
        },
        terminal_error_code: "observation_missing",
      },
      expectedFailureRail: "observation_missing",
    },
    {
      label: "evidence not re-entered",
      payloadPatch: {
        route_product_contract: {
          schema: "helix.route_product_contract.v1",
          allowed_terminal_artifact_kinds: ["typed_failure"],
          required_terminal_kind: "model_synthesized_answer",
        },
        canonical_goal_frame: {
          goal_kind: "tool_request",
          required_terminal_kind: "model_synthesized_answer",
        },
        terminal_error_code: "missing_evidence_reentry",
      },
      expectedFailureRail: "evidence_not_reentered",
    },
    {
      label: "terminal product not allowed",
      payloadPatch: {
        route_product_contract: {
          schema: "helix.route_product_contract.v1",
          allowed_terminal_artifact_kinds: ["typed_failure"],
          required_terminal_kind: "model_synthesized_answer",
        },
        canonical_goal_frame: {
          goal_kind: "tool_request",
          required_terminal_kind: "model_synthesized_answer",
        },
        terminal_error_code: "route_terminal_product_not_allowed",
      },
      expectedFailureRail: "terminal_product_not_allowed",
    },
    {
      label: "visible projection mismatch",
      payloadPatch: {
        route_product_contract: {
          schema: "helix.route_product_contract.v1",
          allowed_terminal_artifact_kinds: ["typed_failure"],
          required_terminal_kind: "model_synthesized_answer",
        },
        canonical_goal_frame: {
          goal_kind: "tool_request",
          required_terminal_kind: "model_synthesized_answer",
        },
        terminal_error_code: "terminal_projection_mismatch",
      },
      expectedFailureRail: "visible_projection_mismatch",
    },
  ])("records procedure trace failure rail for $label", ({ payloadPatch, expectedFailureRail }) => {
    const turnId = `ask:test:procedure-trace:${expectedFailureRail}`;
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      selected_final_answer: "I could not produce a terminal answer for this turn.",
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
      ...payloadPatch,
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: [],
    });

    expect(result.selected_terminal_artifact_kind).toBe("typed_failure");
    expect(payload.ask_turn_procedure_trace).toMatchObject({
      schema: "helix.ask_turn_procedure_trace.v1",
      selected_terminal_product: expect.objectContaining({
        kind: "typed_failure",
      }),
      visible_answer_source: "typed_failure",
      failure_rail: expectedFailureRail,
    });
  });

  it("quarantines workstation circuit observations until solver authority selects a terminal answer", () => {
    const turnId = "ask:test:workstation-circuit-observations-nonterminal";
    const observationText =
      "The frog-classification microdeck produced a likely tree frog packet and queued narration.";
    const artifacts = [
      {
        artifact_id: `${turnId}:goal_context_update`,
        kind: "workstation_goal_context_update",
        payload: {
          schema: "helix.workstation_goal_context_update.v1",
          updateId: `${turnId}:goal_context_update`,
          producerKind: "microdeck",
          sourceRef: "image_lens:frog_upload",
          summary: observationText,
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
      },
      {
        artifact_id: `${turnId}:micro_reasoner_run`,
        kind: "stage_play_micro_reasoner_run",
        payload: {
          schemaVersion: "stage_play_micro_reasoner_run/v1",
          artifactId: "stage_play_micro_reasoner_run",
          runId: `${turnId}:micro_reasoner_run`,
          text: "MicroReasoner frog deck output is available for synthesis.",
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
      },
      {
        artifact_id: `${turnId}:narrator_event`,
        kind: "narrator_event",
        payload: {
          schema: "helix.narrator_event/v1",
          eventId: `${turnId}:narrator_event`,
          text: "Narrator event recorded for the frog-classification output.",
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
      },
      {
        artifact_id: `${turnId}:context_feed_query`,
        kind: "stage_play_workstation_context_feed_query_result",
        payload: {
          schemaVersion: "stage_play_workstation_context_feed_query_result/v1",
          artifactId: "stage_play_workstation_context_feed_query_result",
          feedKind: "microdeck_outputs",
          text: observationText,
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      current_turn_artifact_ledger: artifacts,
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        source_target: "workstation_panel",
        allowed_terminal_artifact_kinds: ["model_synthesized_answer", "typed_failure"],
        forbidden_terminal_artifact_kinds: [
          "helix.workstation_goal_context_update.v1",
          "stage_play_micro_reasoner_run",
          "narrator_event",
          "stage_play_workstation_context_feed_query_result",
        ],
        assistant_answer: false,
        raw_content_included: false,
      },
      canonical_goal_frame: {
        goal_kind: "workstation_goal_context_query",
        required_terminal_kind: "model_synthesized_answer",
      },
      goal_satisfaction_evaluation: {
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
      selected_final_answer: observationText,
      answer: observationText,
      text: observationText,
      terminal_artifact_kind: "stage_play_workstation_context_feed_query_result",
      final_answer_source: "stage_play_workstation_context_feed_query_result",
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        concise_text: observationText,
        terminal_artifact_kind: "stage_play_workstation_context_feed_query_result",
        assistant_answer: false,
        raw_content_included: false,
      },
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("typed_failure");
    expect(result.source).toBe("typed_failure");
    expect(result.visible_text).not.toBe(observationText);
    expect(payload.terminal_error_code).toBe("observation_artifact_cannot_terminalize");
    expect(payload.workstation_observation_terminal_rejection).toMatchObject({
      schema: "helix.workstation_observation_terminal_rejection.v1",
      rejected_terminal_artifact_kind: "stage_play_workstation_context_feed_query_result",
      reason: "observation_artifact_cannot_terminalize",
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(result.rejected_candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "workstation_goal_context_update", reason: "receipt_or_projection" }),
      expect.objectContaining({ kind: "stage_play_micro_reasoner_run", reason: "receipt_or_projection" }),
      expect.objectContaining({ kind: "narrator_event", reason: "receipt_or_projection" }),
      expect.objectContaining({ kind: "stage_play_workstation_context_feed_query_result", reason: "receipt_or_projection" }),
    ]));
    expect(result.integrity.receipt_visible_as_answer).toBe(false);
    expect(result.integrity.forbidden_terminal_candidate_count).toBeGreaterThanOrEqual(4);
  });

  it("fails closed when terminal authority sees a broken tool rail", () => {
    const turnId = "ask:test:broken-tool-rail-terminal-guard";
    const draftText = "A polished answer that should not pass because the requested rail is broken.";
    const artifacts = [
      {
        artifact_id: `${turnId}:draft`,
        kind: "final_answer_draft",
        payload: {
          schema: "helix.final_answer_draft.v1",
          text: draftText,
          authority: "llm_post_observation_composer",
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      current_turn_artifact_ledger: artifacts,
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        allowed_terminal_artifact_kinds: ["model_synthesized_answer", "typed_failure"],
        assistant_answer: false,
        raw_content_included: false,
      },
      canonical_goal_frame: {
        goal_kind: "post_tool_answer",
        required_terminal_kind: "model_synthesized_answer",
      },
      goal_satisfaction_evaluation: {
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
      tool_turn_chain_audit: {
        schema: "helix.tool_turn_chain_audit.v1",
        rail_status: "broken",
        rail_failure_code: "wrong_capability_executed",
        selected_capability: "docs-viewer.locate_in_doc",
        executed_capability: "model.direct_answer",
      },
      selected_final_answer: draftText,
      terminal_artifact_kind: "model_synthesized_answer",
      final_answer_source: "final_answer_draft",
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("typed_failure");
    expect(result.source).toBe("typed_failure");
    expect(payload.terminal_error_code).toBe("wrong_capability_executed");
    expect(String(payload.selected_final_answer)).toContain("wrong_capability_executed");
    expect(payload.terminal_artifact_kind).toBe("typed_failure");
  });

  it("selects materialized docs evidence synthesis over stale solver-continuation failure", () => {
    const turnId = "ask:test:docs-synthesis-supersedes-stale-continuation";
    const answerText = [
      "The document states that routes choose procedures and tools produce observations.",
      "",
      "Document evidence:",
      "- /docs/helix-ask-codex-loop-discipline.md:L214-L218 (Turn-Chain Fundamentals)",
    ].join("\n");
    const artifacts = [
      makePostToolObservation(turnId),
      {
        artifact_id: `${turnId}:doc_location_matches`,
        kind: "doc_location_matches",
        payload: {
          schema: "helix.doc_location_matches.v1",
          kind: "doc_location_matches",
          source_path: "/docs/helix-ask-codex-loop-discipline.md",
          matches: [
            {
              path: "/docs/helix-ask-codex-loop-discipline.md",
              line_start: 214,
              line_end: 218,
              snippet: "Routes choose procedures. Tools produce observations.",
            },
          ],
          assistant_answer: false,
          raw_content_included: false,
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      current_turn_artifact_ledger: artifacts,
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        allowed_terminal_artifact_kinds: ["request_user_input", "typed_failure", "doc_evidence_synthesis_answer"],
        forbidden_terminal_artifact_kinds: ["direct_answer_text", "doc_location_matches"],
        assistant_answer: false,
        raw_content_included: false,
      },
      canonical_goal_frame: {
        goal_kind: "doc_evidence_synthesis",
        required_terminal_kind: "doc_evidence_synthesis_answer",
      },
      source_target_intent: {
        target_source: "docs_viewer",
        target_kind: "document_evidence",
      },
      agent_step_decision: {
        schema: "helix.agent_step_decision.v1",
        decision_id: "agent-step-answer",
        decision_authority: "llm",
        decision_timing: "post_observation",
        next_step: "answer",
        chosen_capability: "model.direct_answer",
      },
      agent_runtime_loop: {
        iterations: [
          {
            iteration: 1,
            decision_id: "agent-step-doc-locate",
            decision_authority: "llm",
            decision_timing: "post_observation",
            next_step: "next_action",
            chosen_capability: "docs-viewer.locate_in_doc",
            executed_action_key: "docs-viewer.locate_in_doc",
            observed_artifact_refs: [`${turnId}:doc_location_matches`],
            tool_observation: {
              status: "completed",
              artifact_refs: [`${turnId}:doc_location_matches`],
            },
          },
          {
            iteration: 2,
            decision_id: "agent-step-answer",
            decision_authority: "llm",
            decision_timing: "post_observation",
            next_step: "answer",
            chosen_capability: "model.direct_answer",
            observation_role: "model_answer_draft",
            observed_artifact_refs: [`${turnId}:doc_evidence_synthesis_answer:from_final_answer_draft`],
          },
        ],
      },
      goal_satisfaction_evaluation: {
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
      tool_turn_chain_audit: {
        schema: "helix.tool_turn_chain_audit.v1",
        rail_status: "fail_closed",
        rail_failure_code: "terminal_projection_mismatch",
        route_family: "docs_viewer",
        requested_capability: "docs-viewer.locate_in_doc",
        selected_capability: "docs-viewer.locate_in_doc",
        executed_capability: "docs-viewer.locate_in_doc",
        observation_artifact_kind: "doc_location_matches",
        observation_ref: `${turnId}:doc_location_matches`,
        reentry_executed: true,
        required_terminal_kind: "doc_evidence_synthesis_answer",
        materialized_terminal_artifact_kind: "typed_failure",
        terminal_authority_kind: "typed_failure",
        visible_terminal_kind: "doc_evidence_synthesis_answer",
        support_refs_count: 3,
      },
      tool_rail_failure_triage: {
        schema: "helix.tool_rail_failure_triage.v1",
        turn_id: turnId,
        rail_status: "fail_closed",
        first_broken_rail: "visible_projection",
        rail_failure_code: "terminal_projection_mismatch",
        failure_bucket: "F_terminal_projection_mismatch",
        repair_target: "presenter_boundary",
        selected_capability: "docs-viewer.locate_in_doc",
        executed_capability: "docs-viewer.locate_in_doc",
      },
      solver_continuation_observation: {
        schema: "helix.solver_continuation_observation.v1",
        required_next_step: "model.direct_answer",
      },
      doc_evidence_synthesis_answer: {
        schema: "helix.doc_evidence_synthesis_answer.v1",
        artifact_id: `${turnId}:doc_evidence_synthesis_answer:from_final_answer_draft`,
        turn_id: turnId,
        answer_text: answerText,
        text: answerText,
        terminal_artifact_kind: "doc_evidence_synthesis_answer",
        support_refs: [`${turnId}:doc_location_matches`, `${turnId}:final_answer_draft`],
        assistant_answer: false,
        raw_content_included: false,
      },
      selected_final_answer: "I could not complete this turn yet because solver continuation is required before terminal answer selection.",
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
      terminal_error_code: "solver_continuation_pending",
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("doc_evidence_synthesis_answer");
    expect(result.source).toBe("final_answer_draft");
    expect(result.visible_text).toBe(answerText);
    expect(result.rejected_candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "typed_failure",
          reason: "stale_solver_continuation_superseded_by_docs_terminal",
        }),
      ]),
    );
    expect(payload.terminal_artifact_kind).toBe("doc_evidence_synthesis_answer");
    expect(payload.final_answer_source).toBe("final_answer_draft");
    expect(payload.terminal_error_code).toBeUndefined();
    expect((payload.terminal_presentation as Record<string, unknown>).terminal_artifact_kind).toBe("doc_evidence_synthesis_answer");
  });

  it("resyncs stale single-writer mirror after final docs terminal authority is recorded", () => {
    const turnId = "ask:test:docs-terminal-authority-resync";
    const answerText = "The cited document says receipts are observations, not terminal answers.";
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      canonical_goal_frame: {
        goal_kind: "doc_evidence_synthesis",
        required_terminal_kind: "doc_evidence_synthesis_answer",
      },
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        allowed_terminal_artifact_kinds: ["doc_evidence_synthesis_answer", "typed_failure"],
      },
      doc_evidence_synthesis_answer: {
        schema: "helix.doc_evidence_synthesis_answer.v1",
        artifact_id: `${turnId}:doc_evidence_synthesis_answer:from_final_answer_draft`,
        turn_id: turnId,
        answer_text: answerText,
        text: answerText,
        terminal_artifact_kind: "doc_evidence_synthesis_answer",
        support_refs: [`${turnId}:doc_location_matches`, `${turnId}:final_answer_draft`],
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        thread_id: "thread:test",
        turn_id: turnId,
        terminal_kind: "answer",
        final_answer_source: "final_answer_draft",
        terminal_artifact_kind: "doc_evidence_synthesis_answer",
        terminal_text_preview: answerText,
        terminal_text_hash: "hash:docs",
        server_authoritative: true,
        assistant_answer: false,
      },
      terminal_authority_single_writer: {
        schema: "helix.terminal_authority_single_writer_result.v1",
        artifactId: "terminal_authority_single_writer",
        schemaVersion: "helix.terminal_authority_single_writer.v1",
        turn_id: turnId,
        selected_terminal_artifact_kind: "typed_failure",
        selected_terminal_artifact_ref: "typed_failure:stale",
        selectedArtifactKind: "typed_failure",
        selectedArtifactRef: "typed_failure:stale",
        visible_text: "I could not produce a terminal answer for this turn.",
        assistant_answer: false,
        source: "typed_failure",
        rejected_candidates: [],
        writes: {
          payload_text: "I could not produce a terminal answer for this turn.",
          payload_answer: "I could not produce a terminal answer for this turn.",
          payload_assistant_answer: "I could not produce a terminal answer for this turn.",
          payload_selected_final_answer: "I could not produce a terminal answer for this turn.",
          terminal_presentation_concise_text: "I could not produce a terminal answer for this turn.",
          debug_selected_final_answer: "I could not produce a terminal answer for this turn.",
        },
        integrity: {
          single_writer_applied: true,
          visible_matches_selected_artifact: true,
          visible_matches_draft: false,
          stale_failure_visible: false,
          receipt_visible_as_answer: false,
          post_tool_model_step_satisfied: false,
          legacy_terminal_candidate_count: 0,
          forbidden_terminal_candidate_count: 0,
          payload_mirror_written_after_terminal_selection: true,
          materialized_terminal_artifact_kind: null,
          materialized_terminal_artifact_ref: null,
        },
      },
      tool_turn_chain_audit: {
        schema: "helix.tool_turn_chain_audit.v1",
        route_family: "docs_viewer",
        requested_capability: "docs-viewer.locate_in_doc",
        selected_capability: "docs-viewer.locate_in_doc",
        executed_capability: "docs-viewer.locate_in_doc",
        requested_selected_match: true,
        selected_executed_match: true,
        observation_artifact_kind: "doc_location_matches",
        observation_ref: `${turnId}:doc_location_matches`,
        required_terminal_kind: "doc_evidence_synthesis_answer",
        expected_reentry_capability: "model.direct_answer",
        reentry_executed: true,
        final_answer_draft_ref: `${turnId}:final_answer_draft`,
        support_refs_count: 2,
        materialized_terminal_artifact_kind: "typed_failure",
        terminal_authority_kind: "typed_failure",
        visible_terminal_kind: "doc_evidence_synthesis_answer",
        rail_status: "fail_closed",
        rail_failure_code: "terminal_projection_mismatch",
        assistant_answer: false,
        raw_content_included: false,
      },
      tool_rail_failure_triage: {
        schema: "helix.tool_rail_failure_triage.v1",
        turn_id: turnId,
        route_family: "docs_viewer",
        selected_capability: "docs-viewer.locate_in_doc",
        executed_capability: "docs-viewer.locate_in_doc",
        observation_artifact_kind: "doc_location_matches",
        observation_ref: `${turnId}:doc_location_matches`,
        required_terminal_kind: "doc_evidence_synthesis_answer",
        materialized_terminal_artifact_kind: "typed_failure",
        terminal_authority_kind: "typed_failure",
        visible_terminal_kind: "doc_evidence_synthesis_answer",
        first_broken_rail: "visible_projection",
        failure_bucket: "F_terminal_projection_mismatch",
        rail_status: "fail_closed",
        rail_failure_code: "terminal_projection_mismatch",
        repair_target: "presenter_boundary",
        assistant_answer: false,
        raw_content_included: false,
      },
      tool_turn_chain_family_matrix: [{
        route_family: "docs_viewer",
        observed: true,
        materialized: true,
        materialized_terminal_artifact_kind: "typed_failure",
        terminal_authority_selected: true,
        visible_projection_matches: false,
        rail_status: "fail_closed",
        rail_failure_code: "terminal_projection_mismatch",
      }],
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        turn_id: turnId,
        terminal_artifact_kind: "typed_failure",
        concise_text: "I could not produce a terminal answer for this turn.",
      },
      selected_final_answer: "I could not produce a terminal answer for this turn.",
      answer: "I could not produce a terminal answer for this turn.",
      text: "I could not produce a terminal answer for this turn.",
      debug: {},
    };

    const result = syncDocEvidenceSynthesisSingleWriterFromTerminalAuthority({
      payload,
      turnId,
      threadId: "thread:test",
    });

    expect(result?.selected_terminal_artifact_kind).toBe("doc_evidence_synthesis_answer");
    expect(result?.source).toBe("final_answer_draft");
    expect(result?.visible_text).toBe(answerText);
    expect(result?.integrity.materialized_terminal_artifact_kind).toBe("doc_evidence_synthesis_answer");
    expect(payload.terminal_artifact_kind).toBe("doc_evidence_synthesis_answer");
    expect(payload.final_answer_source).toBe("final_answer_draft");
    expect(payload.selected_final_answer).toBe(answerText);
    expect((payload.terminal_presentation as Record<string, unknown>).terminal_artifact_kind).toBe("doc_evidence_synthesis_answer");
    expect(payload.tool_turn_chain_audit).toMatchObject({
      materialized_terminal_artifact_kind: "doc_evidence_synthesis_answer",
      terminal_authority_kind: "doc_evidence_synthesis_answer",
      visible_terminal_kind: "doc_evidence_synthesis_answer",
      rail_status: "complete",
      rail_failure_code: null,
    });
    expect(payload.tool_rail_failure_triage).toMatchObject({
      materialized_terminal_artifact_kind: "doc_evidence_synthesis_answer",
      terminal_authority_kind: "doc_evidence_synthesis_answer",
      visible_terminal_kind: "doc_evidence_synthesis_answer",
      first_broken_rail: null,
      failure_bucket: null,
      rail_status: "complete",
      rail_failure_code: null,
      repair_target: null,
    });
    expect(payload.tool_turn_chain_family_matrix).toEqual([
      expect.objectContaining({
        route_family: "docs_viewer",
        observed: true,
        materialized_terminal_artifact_kind: "doc_evidence_synthesis_answer",
        visible_projection_matches: true,
        rail_status: "complete",
        rail_failure_code: null,
      }),
    ]);
    expect((payload.debug as Record<string, unknown>).terminal_authority_single_writer).toMatchObject({
      selected_terminal_artifact_kind: "doc_evidence_synthesis_answer",
      visible_text: answerText,
    });
  });

  it("lets a proven workstation tool evaluation repair stale calculator terminal materialization rails", () => {
    const turnId = "ask:test:calculator-workstation-terminal-rail-repair";
    const answerText = "Calculator verification plan completed.\nExpression: 2 + 2\nResult: 4\nTrace source: scientific-calculator.solve_expression.";
    const artifacts = [
      {
        artifact_id: `${turnId}:calculator_receipt:1`,
        kind: "calculator_receipt",
        payload: {
          schema: "helix.calculator_receipt.v1",
          receipt_id: `${turnId}:calculator_receipt:1`,
          capability_key: "scientific-calculator.solve_expression",
          expression: "2 + 2",
          result: 4,
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
      },
      {
        artifact_id: `${turnId}:workstation_tool_evaluation:1`,
        kind: "workstation_tool_evaluation",
        payload: {
          schema: "helix.workstation_tool_evaluation.v1",
          evaluation_id: `${turnId}:workstation_tool_evaluation:1`,
          tool_key: "scientific-calculator.solve_expression",
          supports_goal: true,
          summary: answerText,
          assistant_answer: false,
          raw_content_included: false,
        },
      },
      {
        artifact_id: `${turnId}:final_answer_draft:1`,
        kind: "final_answer_draft",
        payload: {
          schema: "helix.final_answer_draft.v1",
          text: answerText,
          support_refs: [`${turnId}:calculator_receipt:1`, `${turnId}:workstation_tool_evaluation:1`],
          artifact_refs: [`${turnId}:calculator_receipt:1`, `${turnId}:workstation_tool_evaluation:1`],
          assistant_answer: false,
          raw_content_included: false,
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      active_prompt:
        "Call scientific-calculator.solve_expression with this exact expression: 2 + 2. Wait for calculator_receipt and answer from workstation_tool_evaluation.",
      canonical_goal_frame: {
        schema: "helix.canonical_goal_frame.v1",
        goal_kind: "calculator_solve",
        required_terminal_kind: "workstation_tool_evaluation",
      },
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        source_target: "calculator_stream",
        allowed_terminal_artifact_kinds: ["workstation_tool_evaluation", "typed_failure"],
        required_terminal_kinds: ["workstation_tool_evaluation"],
      },
      capability_itinerary: {
        schema: "helix.capability_itinerary.v1",
        admitted_tool_families: ["calculator"],
        terminal_success_criteria: {
          required_observation_families: ["calculator"],
          required_capabilities: ["scientific-calculator.solve_expression"],
          requires_post_observation_synthesis: true,
        },
        compound_capability_contract: {
          schema: "helix.compound_capability_contract.v1",
          subgoals: [{
            subgoal_id: `${turnId}:compound_capability_subgoal:1:scientific-calculator_solve_expression`,
            order: 1,
            requested_capability: "scientific-calculator.solve_expression",
            runtime_capability: "scientific-calculator.solve_expression",
            required_args: ["latex"],
            optional_args: ["expression", "equation"],
            args_hint: {},
            required_observation_kinds: [
              "calculator_receipt",
              "workstation_tool_evaluation",
            ],
            required_terminal_kind: "workstation_tool_evaluation",
          }],
        },
      },
      capability_plan: {
        schema: "helix.capability_plan.v1",
        turn_id: turnId,
        capability_family: "calculator",
        requested_capability: "scientific-calculator.solve_expression",
        requested_action: "scientific-calculator.solve_expression",
        selected_capability: "scientific-calculator.solve_expression",
        admission_status: "admitted",
        required_terminal_kind: "workstation_tool_evaluation",
      },
      tool_call_admission_decision: {
        requested_capability: "scientific-calculator.solve_expression",
        requested_capability_family: "calculator",
        requested_capability_source: "explicit_user_command",
        selected_capability: "scientific-calculator.solve_expression",
        admitted_capability: "scientific-calculator.solve_expression",
      },
      runtime_tool_call: {
        tool_call_id: "tool:calculator-workstation-terminal-rail-repair",
        capability_key: "scientific-calculator.solve_expression",
        status: "completed",
      },
      agent_runtime_loop: {
        schema: "helix.agent_runtime_loop.v1",
        iterations: [
          {
            iteration: 1,
            decision_id: `${turnId}:agent_runtime_loop:decision:1`,
            decision_authority: "llm",
            decision_timing: "pre_tool",
            next_step: "tool",
            chosen_capability: "scientific-calculator.solve_expression",
            observed_artifact_refs: [`${turnId}:calculator_receipt:1`, `${turnId}:workstation_tool_evaluation:1`],
            tool_observation: {
              status: "completed",
              kind: "calculator_receipt",
              artifact_id: `${turnId}:calculator_receipt:1`,
            },
          },
          {
            iteration: 2,
            decision_id: `${turnId}:agent_runtime_loop:decision:2`,
            decision_authority: "llm",
            decision_timing: "post_observation",
            next_step: "answer",
            chosen_capability: "model.direct_answer",
            observation_role: "model_answer_draft",
            observed_artifact_refs: [`${turnId}:final_answer_draft:1`],
          },
        ],
      },
      agent_step_decision: {
        schema: "helix.agent_step_decision.v1",
        decision_id: `${turnId}:agent_runtime_loop:decision:2`,
        decision_authority: "llm",
        decision_timing: "post_observation",
        next_step: "answer",
        chosen_capability: "model.direct_answer",
      },
      tool_lifecycle_trace: {
        schema: "helix.tool_lifecycle_trace.v1",
        requested_capability: "scientific-calculator.solve_expression",
        admitted_capability: "scientific-calculator.solve_expression",
        executed_capability: "scientific-calculator.solve_expression",
        observation_refs: [`${turnId}:calculator_receipt:1`, `${turnId}:workstation_tool_evaluation:1`],
        receipt_refs: [`${turnId}:calculator_receipt:1`],
        evidence_refs: [`${turnId}:workstation_tool_evaluation:1`],
        lifecycle_stage: "reentered_solver",
        status: "succeeded",
        evidence_reentered: true,
        terminal_eligible: true,
      },
      tool_followup_decision: {
        evidence_reentered: true,
        next_action: "terminal_answer",
      },
      goal_satisfaction_evaluation: {
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
        required_terminal_kind: "workstation_tool_evaluation",
      },
      tool_turn_chain_audit: {
        schema: "helix.tool_turn_chain_audit.v1",
        route_family: "calculator",
        requested_capability: "scientific-calculator.solve_expression",
        selected_capability: "scientific-calculator.solve_expression",
        executed_capability: "scientific-calculator.solve_expression",
        observation_artifact_kind: "calculator_receipt",
        observation_ref: `${turnId}:calculator_receipt:1`,
        reentry_executed: true,
        required_terminal_kind: "workstation_tool_evaluation",
        materialized_terminal_artifact_kind: "typed_failure",
        terminal_authority_kind: "typed_failure",
        visible_terminal_kind: "typed_failure",
        rail_status: "fail_closed",
        rail_failure_code: "terminal_not_materialized",
        assistant_answer: false,
        raw_content_included: false,
      },
      tool_rail_failure_triage: {
        schema: "helix.tool_rail_failure_triage.v1",
        turn_id: turnId,
        route_family: "calculator",
        selected_capability: "scientific-calculator.solve_expression",
        executed_capability: "scientific-calculator.solve_expression",
        observation_artifact_kind: "calculator_receipt",
        observation_ref: `${turnId}:calculator_receipt:1`,
        required_terminal_kind: "workstation_tool_evaluation",
        materialized_terminal_artifact_kind: "typed_failure",
        terminal_authority_kind: "typed_failure",
        visible_terminal_kind: "typed_failure",
        first_broken_rail: "terminal_materialization",
        failure_bucket: "E_terminal_materializer_gap",
        rail_status: "fail_closed",
        rail_failure_code: "terminal_not_materialized",
        repair_target: "terminal_materializer",
        assistant_answer: false,
        raw_content_included: false,
      },
      final_answer_draft_selection: {
        schema: "helix.final_answer_draft_selection.v1",
        materialized_terminal_artifact_kind: "model_synthesized_answer",
        materialized_terminal_artifact_ref: `${turnId}:model_synthesized_answer:from_final_answer_draft`,
      },
      selected_final_answer:
        "I could not produce a terminal answer because terminal authority and visible projection selected different artifacts.",
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
      terminal_error_code: "terminal_projection_mismatch",
      current_turn_artifact_ledger: artifacts,
      debug: {},
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("workstation_tool_evaluation");
    expect(result.source).toBe("workstation_tool_evaluation");
    expect(result.visible_text).toBe(answerText);
    expect(result.integrity.materialized_terminal_artifact_kind).toBe("workstation_tool_evaluation");
    expect(payload.terminal_artifact_kind).toBe("workstation_tool_evaluation");
    expect(payload.final_answer_source).toBe("workstation_tool_evaluation");
    expect(payload.terminal_error_code).toBeUndefined();
    expect(payload.capability_itinerary_execution_state).toMatchObject({
      complete: true,
      missing_required_capabilities: [],
      missing_compound_subgoal_ids: [],
      compound_subgoal_ledger: [{
        selected_args: { expression: "2 + 2" },
        satisfaction: "satisfied",
        rail_status: "complete",
      }],
    });
    expect(payload.final_answer_draft_selection).toMatchObject({
      materialized_terminal_artifact_kind: "workstation_tool_evaluation",
      materialized_terminal_artifact_ref: `${turnId}:workstation_tool_evaluation:1`,
    });
    expect(payload.ask_turn_procedure_trace).toMatchObject({
      schema: "helix.ask_turn_procedure_trace.v1",
      intent_class: "calculator_solve",
      evidence_reentry_status: "reentered",
      admitted_capabilities: expect.arrayContaining(["scientific-calculator.solve_expression"]),
      allowed_terminal_products: expect.arrayContaining(["workstation_tool_evaluation"]),
      selected_terminal_product: expect.objectContaining({
        kind: "workstation_tool_evaluation",
        allowed_by_route: true,
      }),
      visible_answer_source: "workstation_tool_evaluation",
      failure_rail: null,
    });

    const index = buildArtifactQueryIndex({ turnId, payload });
    expect(index.tool_turn_chain_audit).toMatchObject({
      requested_capability: "scientific-calculator.solve_expression",
      selected_capability: "scientific-calculator.solve_expression",
      executed_capability: "scientific-calculator.solve_expression",
      observation_artifact_kind: "calculator_receipt",
      required_terminal_kind: "workstation_tool_evaluation",
      materialized_terminal_artifact_kind: "workstation_tool_evaluation",
      terminal_authority_kind: "workstation_tool_evaluation",
      visible_terminal_kind: "workstation_tool_evaluation",
      rail_status: "complete",
      rail_failure_code: null,
    });
    expect(index.codex_parity_agent_spine_rail_table).toMatchObject({
      required_terminal_kind: "workstation_tool_evaluation",
      selected_terminal_kind: "workstation_tool_evaluation",
      visible_terminal_kind: "workstation_tool_evaluation",
      rail_status: "complete",
      codex_parity_class: "complete",
    });
  });

  it("mirrors a terminal-authority-selected workstation evaluation instead of reporting repair failure", () => {
    const turnId = "ask:test:workstation-authority-envelope-mirror";
    const answerText =
      "I located this discussion in the Theory Badge Graph, then built a first-principles explanation route from that reflection.";
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      canonical_goal_frame: {
        schema: "helix.canonical_goal_frame.v1",
        goal_kind: "theory_context_reflection",
        required_terminal_kind: "workstation_tool_evaluation",
      },
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        source_target: "theory_badge_graph",
        allowed_terminal_artifact_kinds: ["workstation_tool_evaluation", "typed_failure"],
        required_terminal_kinds: ["workstation_tool_evaluation"],
      },
      capability_plan: {
        schema: "helix.capability_plan.v1",
        turn_id: turnId,
        capability_family: "theory_context_reflection",
        requested_capability: "helix_ask.reflect_theory_context",
        requested_action: "helix_ask.reflect_theory_context",
        selected_capability: "helix_ask.reflect_theory_context",
        admission_status: "admitted",
        required_terminal_kind: "workstation_tool_evaluation",
      },
      tool_lifecycle_trace: {
        schema: "helix.tool_lifecycle_trace.v1",
        requested_capability: "helix_ask.reflect_theory_context",
        admitted_capability: "helix_ask.reflect_theory_context",
        executed_capability: "helix_ask.reflect_theory_context",
        observation_refs: [`${turnId}:theory_reflection_receipt`, `${turnId}:workstation_tool_evaluation`],
        receipt_refs: [`${turnId}:theory_reflection_receipt`],
        evidence_refs: [`${turnId}:workstation_tool_evaluation`],
        lifecycle_stage: "reentered_solver",
        status: "succeeded",
        evidence_reentered: true,
        terminal_eligible: true,
      },
      agent_runtime_loop: {
        schema: "helix.agent_runtime_loop.v1",
        iterations: [
          {
            iteration: 1,
            decision_id: `${turnId}:agent_runtime_loop:decision:1`,
            decision_authority: "llm",
            decision_timing: "pre_tool",
            next_step: "tool",
            chosen_capability: "helix_ask.reflect_theory_context",
            observed_artifact_refs: [`${turnId}:theory_reflection_receipt`, `${turnId}:workstation_tool_evaluation`],
            tool_observation: {
              status: "completed",
              kind: "helix_theory_context_reflection_tool_receipt",
              artifact_id: `${turnId}:theory_reflection_receipt`,
            },
          },
          {
            iteration: 2,
            decision_id: `${turnId}:agent_runtime_loop:decision:2`,
            decision_authority: "llm",
            decision_timing: "post_observation",
            next_step: "answer",
            chosen_capability: "model.direct_answer",
            observation_role: "model_answer_draft",
            observed_artifact_refs: [`${turnId}:workstation_tool_evaluation`],
          },
        ],
      },
      agent_step_decision: {
        schema: "helix.agent_step_decision.v1",
        decision_id: `${turnId}:agent_runtime_loop:decision:2`,
        decision_authority: "llm",
        decision_timing: "post_observation",
        next_step: "answer",
        chosen_capability: "model.direct_answer",
      },
      goal_satisfaction_evaluation: {
        schema: "helix.goal_satisfaction_evaluation.v1",
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
        required_terminal_kind: "workstation_tool_evaluation",
      },
      tool_turn_chain_audit: {
        schema: "helix.tool_turn_chain_audit.v1",
        route_family: "theory_context_reflection",
        requested_capability: "helix_ask.reflect_theory_context",
        selected_capability: "helix_ask.reflect_theory_context",
        executed_capability: "helix_ask.reflect_theory_context",
        observation_artifact_kind: "workstation_tool_evaluation",
        observation_ref: `${turnId}:workstation_tool_evaluation`,
        reentry_executed: true,
        required_terminal_kind: "workstation_tool_evaluation",
        materialized_terminal_artifact_kind: "workstation_tool_evaluation",
        terminal_authority_kind: "workstation_tool_evaluation",
        visible_terminal_kind: "workstation_tool_evaluation",
        rail_status: "complete",
        rail_failure_code: null,
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        thread_id: "thread:test",
        turn_id: turnId,
        terminal_kind: "tool_evaluation",
        final_answer_source: "workstation_tool_evaluation",
        terminal_artifact_kind: "workstation_tool_evaluation",
        terminal_text_preview: answerText,
        terminal_text_hash: "hash:workstation-authority",
        server_authoritative: true,
        assistant_answer: false,
      },
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        turn_id: turnId,
        terminal_artifact_kind: "workstation_tool_evaluation",
        final_answer_source: "workstation_tool_evaluation",
        concise_text: answerText,
        assistant_answer: false,
        raw_content_included: false,
      },
      workstation_tool_evaluation: {
        schema: "helix.workstation_tool_evaluation.v1",
        evaluation_id: `${turnId}:workstation_tool_evaluation`,
        supports_goal: true,
        summary: answerText,
        answer_text: answerText,
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_artifact_kind: "workstation_tool_evaluation",
      terminal_artifact_id: `${turnId}:workstation_tool_evaluation`,
      final_answer_source: "workstation_tool_evaluation",
      selected_final_answer: answerText,
      answer: answerText,
      text: answerText,
      ok: true,
      response_type: "final_answer",
      final_status: "final_answer",
      current_turn_artifact_ledger: [
        {
          artifact_id: `${turnId}:theory_reflection_receipt`,
          kind: "helix_theory_context_reflection_tool_receipt",
          payload: {
            schema: "helix.helix_theory_context_reflection_tool_receipt.v1",
            receipt_id: `${turnId}:theory_reflection_receipt`,
            status: "completed",
            assistant_answer: false,
            raw_content_included: false,
          },
        },
        {
          artifact_id: `${turnId}:workstation_tool_evaluation`,
          kind: "workstation_tool_evaluation",
          payload: {
            schema: "helix.workstation_tool_evaluation.v1",
            evaluation_id: `${turnId}:workstation_tool_evaluation`,
            supports_goal: true,
            summary: answerText,
            answer_text: answerText,
            assistant_answer: false,
            raw_content_included: false,
          },
        },
      ],
      debug: {},
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: [],
    });

    expect(result.selected_terminal_artifact_kind).toBe("workstation_tool_evaluation");
    expect(result.source).toBe("workstation_tool_evaluation");
    expect(result.source).not.toBe("terminal_authority_repair_failure");
    expect(result.visible_text).toBe(answerText);
    expect(result.integrity.materialized_terminal_artifact_kind).toBe("workstation_tool_evaluation");
    expect(payload.terminal_authority_single_writer).toMatchObject({
      selected_terminal_artifact_kind: "workstation_tool_evaluation",
      source: "workstation_tool_evaluation",
      visible_text: answerText,
    });
    expect((payload.debug as Record<string, unknown>).terminal_authority_single_writer).toMatchObject({
      selected_terminal_artifact_kind: "workstation_tool_evaluation",
      source: "workstation_tool_evaluation",
    });
  });

  it("quarantines note receipts as side evidence and selects the synthesized note answer", () => {
    const turnId = "ask:test:note-receipt-quarantine";
    const artifacts = [
      {
        artifact_id: `${turnId}:note_update_receipt`,
        kind: "note_update_receipt",
        payload: {
          schema: "helix.note_update_receipt.v1",
          kind: "note_update_receipt",
          title: "Tool Test",
          message: "Updated note Tool Test.",
          text: "Updated note Tool Test.",
        },
      },
      {
        artifact_id: `${turnId}:obs`,
        kind: "agent_step_observation_packet",
        payload: {
          schema: "helix.agent_step_observation_packet.v1",
          turn_id: turnId,
          status: "succeeded",
          terminal_eligible: false,
          post_tool_model_step_required: true,
          capability_id: "workstation-notes.create_note",
          produced_artifact_refs: [`${turnId}:note_update_receipt`],
        },
      },
      {
        artifact_id: `${turnId}:final_answer_draft`,
        kind: "final_answer_draft",
        payload: {
          schema: "helix.final_answer_draft.v1",
          text: "I updated the Tool Test note with the requested text.",
          authority: "llm_post_observation_composer",
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      active_prompt: "Create a note titled Tool Test with the text receipts are observations.",
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        turn_id: turnId,
        thread_id: "thread:test",
        source_target: "workstation_panel",
        allowed_terminal_artifact_kinds: ["model_synthesized_answer", "typed_failure", "request_user_input"],
        forbidden_terminal_artifact_kinds: ["note_update_receipt", "note_action_receipt", "note_create_receipt", "workspace_action_receipt"],
        side_artifact_kinds_allowed: ["note_update_receipt"],
        required_artifact_refs: [],
        precedence_reason: "test",
        assistant_answer: false,
        raw_content_included: false,
      },
      canonical_goal_frame: {
        goal_kind: "note_mutation",
        required_terminal_kind: "model_synthesized_answer",
      },
      current_turn_artifact_ledger: artifacts,
      selected_final_answer: "Updated note Tool Test.",
      answer: "Updated note Tool Test.",
      text: "Updated note Tool Test.",
      terminal_artifact_kind: "note_update_receipt",
      final_answer_source: "note_update_receipt",
      agent_runtime_loop: {
        iterations: [
          {
            iteration: 1,
            next_step: "next_action",
            chosen_capability: "workstation-notes.create_note",
            decision_authority: "llm",
            observed_artifact_refs: [`${turnId}:obs`, `${turnId}:note_update_receipt`],
          },
          {
            iteration: 2,
            next_step: "answer",
            chosen_capability: "model.answer",
            decision_authority: "llm",
            observation_role: "model_answer_draft",
          },
        ],
      },
      goal_satisfaction_evaluation: {
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
      agent_runtime_loop: {
        schema: "helix.agent_step_loop.v1",
        iterations: [
          {
            iteration: 1,
            decision_id: `${turnId}:decision:create-note`,
            next_step: "next_action",
            chosen_capability: "workstation-notes.create_note",
            decision_authority: "helix_policy",
            observed_artifact_refs: [`${turnId}:obs`, `${turnId}:note_update_receipt`],
          },
          {
            iteration: 2,
            decision_id: `${turnId}:decision:receipt-terminal`,
            decision_timing: "terminal_review",
            next_step: "answer",
            chosen_capability: "workstation-notes.create_note",
            decision_authority: "deterministic_policy_fallback",
            observed_artifact_refs: [`${turnId}:note_update_receipt`],
          },
        ],
      },
      agent_step_loop: {
        schema: "helix.agent_step_loop.v1",
        steps: [
          {
            decision_ref: `${turnId}:decision:create-note`,
            chosen_capability: "workstation-notes.create_note",
            next_step: "next_action",
            observed_artifact_refs: [`${turnId}:obs`, `${turnId}:note_update_receipt`],
          },
          {
            decision_ref: `${turnId}:decision:receipt-terminal`,
            chosen_capability: "workstation-notes.create_note",
            next_step: "answer",
            observed_artifact_refs: [`${turnId}:note_update_receipt`],
          },
        ],
      },
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("model_synthesized_answer");
    expect(result.visible_text).toBe("I updated the Tool Test note with the requested text.");
    expect(result.integrity.receipt_visible_as_answer).toBe(false);
    expect(result.rejected_candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "note_update_receipt", reason: "receipt_or_projection" }),
      ]),
    );
    expect(payload.terminal_artifact_kind).toBe("model_synthesized_answer");
    expect(payload.final_answer_source).toBe("final_answer_draft");
  });

  it("selects a note receipt when the create-note contract authorizes receipt terminal authority", () => {
    const turnId = "ask:test:create-note-receipt-terminal";
    const artifacts = [
      {
        artifact_id: `${turnId}:note_update_receipt`,
        kind: "note_update_receipt",
        payload: {
          schema: "helix.note_update_receipt.v1",
          kind: "note_update_receipt",
          title: "Helix Ask Note",
          message: "Created note: hh",
          text: "Created note: hh",
        },
      },
      {
        artifact_id: `${turnId}:final_answer_draft`,
        kind: "final_answer_draft",
        payload: {
          schema: "helix.final_answer_draft.v1",
          text: "I created the note.",
          authority: "llm_post_observation_composer",
        },
      },
      {
        artifact_id: `${turnId}:obs`,
        kind: "agent_step_observation_packet",
        payload: {
          schema: "helix.agent_step_observation_packet.v1",
          turn_id: turnId,
          status: "succeeded",
          terminal_eligible: false,
          post_tool_model_step_required: false,
          capability_id: "workstation-notes.create_note",
          capability_key: "workstation-notes.create_note",
          tool_name: "workstation-notes.create_note",
          action: {
            panel_id: "workstation-notes",
            action_id: "create_note",
          },
          produced_artifact_refs: [`${turnId}:note_update_receipt`],
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      active_prompt: 'Make a note for me "hh".',
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        turn_id: turnId,
        thread_id: "thread:test",
        source_target: "workspace_action",
        allowed_terminal_artifact_kinds: ["note_update_receipt", "typed_failure", "request_user_input"],
        forbidden_terminal_artifact_kinds: ["model_synthesized_answer", "direct_answer_text", "panel_generated_answer"],
        side_artifact_kinds_allowed: ["workspace_action_receipt", "note_action_receipt", "note_create_receipt"],
        required_artifact_refs: [],
        precedence_reason: "explicit_create_note_prompt_requires_note_update_receipt_terminal_authority",
        assistant_answer: false,
        raw_content_included: false,
      },
      canonical_goal_frame: {
        goal_kind: "note_mutation",
        required_terminal_kind: "note_update_receipt",
      },
      current_turn_artifact_ledger: artifacts,
      step_results: [
        {
          step_id: "workspace_action_create_note",
          status: "completed",
          actual_artifacts: ["note_update_receipt"],
          result_artifact: {
            artifact_id: `${turnId}:note_update_receipt`,
            kind: "note_update_receipt",
            schema: "helix.note_update_receipt.v1",
            message: "Created note: hh",
            text: "Created note: hh",
          },
        },
      ],
      selected_capability: "workstation-notes.create_note",
      agent_step_decision: {
        schema: "helix.agent_step_decision.v1",
        decision_id: `${turnId}:decision:receipt-terminal`,
        chosen_capability: "workstation-notes.create_note",
        next_step: "answer",
        decision_timing: "terminal_review",
        decision_authority: "deterministic_policy_fallback",
      },
      final_answer_draft: {
        schema: "helix.final_answer_draft.v1",
        text: "I created the note.",
      },
      goal_satisfaction_evaluation: {
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
      agent_runtime_loop: {
        schema: "helix.agent_step_loop.v1",
        iterations: [
          {
            iteration: 1,
            decision_id: `${turnId}:decision:create-note`,
            next_step: "next_action",
            chosen_capability: "workstation-notes.create_note",
            decision_authority: "helix_policy",
            observed_artifact_refs: [`${turnId}:obs`, `${turnId}:note_update_receipt`],
          },
          {
            iteration: 2,
            decision_id: `${turnId}:decision:receipt-terminal`,
            decision_timing: "terminal_review",
            next_step: "answer",
            chosen_capability: "workstation-notes.create_note",
            decision_authority: "deterministic_policy_fallback",
            observed_artifact_refs: [`${turnId}:note_update_receipt`],
          },
        ],
      },
      agent_step_loop: {
        schema: "helix.agent_step_loop.v1",
        steps: [
          {
            decision_ref: `${turnId}:decision:create-note`,
            chosen_capability: "workstation-notes.create_note",
            next_step: "next_action",
            observed_artifact_refs: [`${turnId}:obs`, `${turnId}:note_update_receipt`],
          },
          {
            decision_ref: `${turnId}:decision:receipt-terminal`,
            chosen_capability: "workstation-notes.create_note",
            next_step: "answer",
            observed_artifact_refs: [`${turnId}:note_update_receipt`],
          },
        ],
      },
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("note_update_receipt");
    expect(result.source).toBe("note_update_receipt");
    expect(result.visible_text).toBe("Created note: hh");
    expect(payload.terminal_artifact_kind).toBe("note_update_receipt");
    expect(payload.final_answer_source).toBe("note_update_receipt");
    expect(payload.ask_turn_procedure_trace).toMatchObject({
      schema: "helix.ask_turn_procedure_trace.v1",
      intent_class: "note_mutation",
      evidence_reentry_status: "reentered",
      allowed_terminal_products: expect.arrayContaining(["note_update_receipt"]),
      selected_terminal_product: expect.objectContaining({
        kind: "note_update_receipt",
        allowed_by_route: true,
      }),
      visible_answer_source: "note_update_receipt",
      failure_rail: null,
    });
  });

  it("selects a live-pipeline receipt only when the exact control contract authorizes it", () => {
    const turnId = "ask:test:live-pipeline-receipt-terminal";
    const receiptRef = `${turnId}:live_pipeline_receipt`;
    const modelText = "I set the live visual producer cadence to 30 seconds.";
    const artifacts = [
      {
        artifact_id: receiptRef,
        kind: "live_pipeline_receipt",
        payload: {
          schema: "helix.live_pipeline_turn_receipt.v1",
          kind: "live_pipeline_receipt",
          receipt_id: receiptRef,
          status: "succeeded",
          action: "set_visual_producer_cadence",
          interval_seconds: 30,
          assistant_answer: false,
          raw_content_included: false,
        },
      },
    ];
    const routeProductContract = {
      schema: "helix.route_product_contract.v1",
      turn_id: turnId,
      thread_id: "thread:test",
      source_target: "live_pipeline",
      required_terminal_kind: "live_pipeline_receipt",
      allowed_terminal_artifact_kinds: [
        "live_pipeline_receipt",
        "typed_failure",
        "request_user_input",
      ],
      forbidden_terminal_artifact_kinds: [
        "model_synthesized_answer",
        "direct_answer_text",
      ],
      required_artifact_refs: [receiptRef],
      assistant_answer: false,
      raw_content_included: false,
    };
    const canonicalGoalFrame = {
      goal_kind: "live_pipeline_control",
      required_terminal_kind: "live_pipeline_receipt",
    };
    const committedAskRoute = buildCommittedAskRoute({
      turnId,
      promptText: "Set the live visual producer cadence to 30 seconds.",
      selectedRoute: "/ask",
      payload: {
        route_product_contract: routeProductContract,
        canonical_goal_frame: canonicalGoalFrame,
      },
    });
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      committed_ask_route: committedAskRoute,
      route_product_contract: routeProductContract,
      canonical_goal_frame: canonicalGoalFrame,
      source_target_intent: {
        target_source: "live_pipeline",
        allow_no_tool_direct: false,
        allow_client_shortcut: false,
      },
      tool_call_admission_decision: {
        source_target: "live_pipeline",
        required: true,
        requested_capability: "situation-room.live-source.set_rate",
        selected_capability: "situation-room.live-source.set_rate",
        admitted_capability: "situation-room.live-source.set_rate",
        admitted_tool_families: ["live_pipeline"],
      },
      terminal_artifact_selection_guard: {
        schema: "helix.terminal_artifact_selection_guard.v1",
        terminal_artifact_kind: "live_pipeline_receipt",
        source_target: "live_pipeline",
        allowed: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      product_authority_guard: {
        schema: "helix.product_authority_guard.v1",
        terminal_artifact_kind: "live_pipeline_receipt",
        source_target: "live_pipeline",
        allowed: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      route_authority_audit: {
        schema: "helix.route_authority_audit.v1",
        turn_id: turnId,
        source_target: "live_pipeline",
        selected_route: "live_pipeline_control",
        terminal_artifact_kind: "live_pipeline_receipt",
        final_answer_source: "live_pipeline_receipt",
        terminal_artifact_allowed: true,
        route_authority_ok: true,
        violation_codes: [],
        assistant_answer: false,
        raw_content_included: false,
      },
      live_pipeline_turn_receipt: artifacts[0].payload,
      tool_trace_disclosure: {
        schema: "helix.ask_tool_trace_disclosure.v1",
        turn_id: turnId,
        items: [
          {
            capability_id: "situation-room.live-source.set_rate",
            status: "succeeded",
            observation_ref: receiptRef,
          },
        ],
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      current_turn_artifact_ledger: artifacts,
      selected_final_answer: modelText,
      final_answer_draft: {
        schema: "helix.final_answer_draft.v1",
        text: modelText,
        authority: "llm_post_observation_composer",
      },
      goal_satisfaction_evaluation: {
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
        required_terminal_kind: "live_pipeline_receipt",
        terminal_artifact_kind: "live_pipeline_receipt",
        observed_results: [
          {
            kind: "live_pipeline_receipt",
            artifact_ref: receiptRef,
            supports_goal: true,
          },
        ],
      },
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe(
      "live_pipeline_receipt",
    );
    expect(result.source).toBe("live_pipeline_receipt");
    expect(result.visible_text).toBe(modelText);
    expect(payload.terminal_artifact_kind).toBe("live_pipeline_receipt");
    expect(payload.final_answer_source).toBe("live_pipeline_receipt");
    expect(payload.terminal_answer_authority).toMatchObject({
      terminal_kind: "answer",
      terminal_artifact_kind: "live_pipeline_receipt",
      final_answer_source: "live_pipeline_receipt",
      server_authoritative: true,
      terminal_eligible: true,
      single_writer_synchronized: true,
    });
    expect(result.integrity.receipt_visible_as_answer).toBe(false);
  });

  it("blocks receipt terminals for multi-subgoal compound synthesis turns", () => {
    const turnId = "ask:test:compound-receipt-not-terminal";
    const receiptRef = `${turnId}:workspace_action_receipt`;
    const artifacts = [
      {
        artifact_id: receiptRef,
        kind: "workspace_action_receipt",
        payload: {
          schema: "helix.workspace_action_receipt.v1",
          kind: "workspace_action_receipt",
          receipt_kind: "workspace_action_receipt",
          receipt_id: receiptRef,
          text: "Workspace status returned 34 capability records.",
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        turn_id: turnId,
        source_target: "compound_capability",
        required_terminal_kind: "workspace_action_receipt",
        allowed_terminal_artifact_kinds: [
          "workspace_action_receipt",
          "workstation_tool_evaluation",
          "model_synthesized_answer",
          "typed_failure",
        ],
        forbidden_terminal_artifact_kinds: ["tool_receipt"],
        assistant_answer: false,
        raw_content_included: false,
      },
      canonical_goal_frame: {
        goal_kind: "compound_capability",
        required_terminal_kind: "workspace_action_receipt",
      },
      capability_itinerary: {
        schema: "helix.capability_itinerary.v1",
        terminal_success_criteria: {
          requires_post_observation_synthesis: true,
          compound_terminal_policy: "synthesize_from_satisfied_subgoal_observations",
          required_capabilities: [
            "workspace_os.status",
            "scientific-calculator.solve_expression",
          ],
          required_observation_families: ["workspace_diagnostic", "calculator"],
          allowed_terminal_artifact_kinds: [
            "workspace_action_receipt",
            "workstation_tool_evaluation",
            "model_synthesized_answer",
            "typed_failure",
          ],
          forbidden_terminal_artifact_kinds: ["tool_receipt"],
        },
        compound_capability_contract: {
          schema: "helix.compound_capability_contract.v1",
          terminal_policy: "synthesize_from_satisfied_subgoal_observations",
          requires_all_subgoals: true,
          subgoals: [
            {
              subgoal_id: `${turnId}:subgoal:workspace`,
              order: 1,
              requested_capability: "workspace_os.status",
              runtime_capability: "workspace_os.status",
              required_observation_kinds: ["workspace_os_status_observation"],
              required_terminal_kind: "workstation_tool_evaluation",
            },
            {
              subgoal_id: `${turnId}:subgoal:calculator`,
              order: 2,
              requested_capability: "scientific-calculator.solve_expression",
              runtime_capability: "scientific-calculator.solve_expression",
              required_observation_kinds: ["calculator_receipt"],
              required_terminal_kind: "workstation_tool_evaluation",
            },
          ],
        },
      },
      current_turn_artifact_ledger: artifacts,
      step_results: [
        {
          step_id: `${turnId}:step:workspace`,
          result_artifact: {
            kind: "workspace_action_receipt",
            artifact_id: receiptRef,
            receipt_id: receiptRef,
            text: "Workspace status returned 34 capability records.",
          },
        },
      ],
      goal_satisfaction_evaluation: {
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
      selected_final_answer: "Workspace status returned 34 capability records.",
      terminal_artifact_kind: "workspace_action_receipt",
      final_answer_source: "workspace_action_receipt",
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("typed_failure");
    expect(result.selected_terminal_artifact_kind).not.toBe("workspace_action_receipt");
    expect(result.rejected_candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "workspace_action_receipt", reason: "receipt_or_projection" }),
      ]),
    );
    expect(payload.terminal_artifact_kind).toBe("typed_failure");
    expect(payload.final_answer_source).toBe("typed_failure");
  });

  it("fails closed when a required tool observation has no later answer draft", () => {
    const turnId = "ask:test:missing-post-tool-answer";
    const artifacts = [makePostToolObservation(turnId)];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      current_turn_artifact_ledger: artifacts,
      selected_final_answer: "Opening panel: Docs & Papers.",
      terminal_artifact_kind: "workspace_action_receipt",
      final_answer_source: "legacy_fallback",
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("typed_failure");
    expect(result.audit?.rejectedCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          artifactKind: "normal_answer",
          reason: "missing_evidence_reentry",
        }),
      ]),
    );
    expect(result.audit?.forbiddenPreAuthorityVisibleFields).toEqual(
      expect.arrayContaining(["payload.selected_final_answer"]),
    );
    expect(result.integrity.post_tool_model_step_satisfied).toBe(false);
    expect(payload.terminal_artifact_kind).toBe("typed_failure");
    expect(payload.final_answer_source).toBe("typed_failure");
    expect(payload.terminal_error_code).toBe("post_tool_model_step_missing");
    expect(String(payload.selected_final_answer)).toContain("follow-up model answer step");
    expect(payload.terminal_rejection_observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          schema: "helix.terminal_rejection_observation.v1",
          rejection_reason: "missing_post_tool_model_step",
          recoverable: true,
          retryability: "retryable",
          terminal_eligible: false,
          assistant_answer: false,
        }),
      ]),
    );
    expect(payload.agent_continuation_state).toMatchObject({
      schema: "helix.agent_continuation_state.v1",
      trigger: "terminal_rejection",
      last_attempt: {
        failure_class: "terminal_authority",
        retryability: "retryable",
      },
      allowed_decisions: ["retry"],
      terminal_eligible: false,
      assistant_answer: false,
    });
  });

  it("surfaces a same-turn provider candidate authorized after a retry even when the top-level typed failure is stale", () => {
    const turnId = "ask:test:authorized-provider-bridge-after-tool";
    const observation = makePostToolObservation(turnId);
    const observationRef = String(observation.artifact_id);
    const candidateRef = `${turnId}:agent_provider_terminal_candidate:codex:repo`;
    const answerText = "The terminal authority implementation is in server/services/helix-ask/terminal-authority-single-writer.ts.";
    const artifacts = [observation];
    const candidate = {
      schema: "helix.agent_provider_terminal_candidate.v1",
      candidate_id: candidateRef,
      turn_id: turnId,
      candidate_text_preview: answerText,
      grounded_in_observation_refs: [observationRef],
      normalized_observation_refs: [observationRef],
      provider_reasoning_completed: true,
      terminal_eligible: false,
    };
    const bridgeAuthority = {
      schema: "helix.turn_terminal_authority.v1",
      thread_id: "thread:test",
      turn_id: turnId,
      route: "/ask/turn",
      terminal_kind: "answer",
      final_answer_source: "agent_provider_terminal_candidate",
      terminal_artifact_kind: "agent_provider_terminal_candidate",
      terminal_item_id: candidateRef,
      server_authoritative: true,
      terminal_eligible: true,
      assistant_answer: false,
      raw_content_included: false,
    };
    const bridgePresentation = {
      schema: "helix.terminal_presentation.v1",
      turn_id: turnId,
      concise_text: answerText,
      terminal_artifact_kind: "agent_provider_terminal_candidate",
      final_answer_source: "agent_provider_terminal_candidate",
      terminal_authority_ref: candidateRef,
      selected_observation_refs: [observationRef],
      assistant_answer: false,
      raw_content_included: false,
    };
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      ok: false,
      status: "final_failure",
      final_status: "final_failure",
      response_type: "final_failure",
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
      terminal_error_code: "schema_validation_failed",
      terminal_failure_text:
        "The probe arguments failed the trusted schema at $.requested_length.",
      selected_final_answer:
        "The probe arguments failed the trusted schema at $.requested_length.",
      answer:
        "The probe arguments failed the trusted schema at $.requested_length.",
      text: "The probe arguments failed the trusted schema at $.requested_length.",
      typed_failure: {
        schema: "helix.typed_failure.v1",
        turn_id: turnId,
        error_code: "schema_validation_failed",
        message:
          "The probe arguments failed the trusted schema at $.requested_length.",
        assistant_answer: false,
        raw_content_included: false,
      },
      current_turn_artifact_ledger: artifacts,
      committed_ask_route: {
        schema: "helix.committed_ask_route.v1",
        turn_id: turnId,
        route: {
          selected_route: "/ask/turn",
          source_target: "repo_code",
          target_kind: "repo_code",
          strength: "hard",
        },
        canonical_goal: {
          goal_kind: "unknown",
          required_terminal_kind: "unknown",
          allowed_terminal_artifact_kinds: [],
          forbidden_terminal_artifact_kinds: [],
        },
      },
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        required_terminal_artifact_kind: "agent_provider_terminal_candidate",
        allowed_terminal_artifact_kinds: ["agent_provider_terminal_candidate", "typed_failure"],
      },
      canonical_goal_frame: {
        schema: "helix.canonical_goal_frame.v1",
        source: "codex_provider_workstation_gateway_projection",
        goal_kind: "agent_provider_gateway_turn",
        requested_capability: "repo.search",
        required_terminal_kind: "agent_provider_terminal_candidate",
      },
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        turn_id: turnId,
        terminal_kind: "failure",
        terminal_artifact_kind: "typed_failure",
        final_answer_source: "typed_failure",
        server_authoritative: true,
      },
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        turn_id: turnId,
        terminal_artifact_kind: "typed_failure",
        final_answer_source: "typed_failure",
        concise_text: "A tool observation required a follow-up model answer step.",
      },
      provider_reasoning_reentry: {
        schema: "helix.provider_reasoning_reentry.v1",
        turn_id: turnId,
        status: "completed",
        evidence_reentered: true,
        solver_completed: true,
        goal_satisfaction_compatible: true,
      },
      provider_terminal_candidate: candidate,
      provider_terminal_authority_bridge: {
        schema: "helix.provider_terminal_authority_bridge.v1",
        turn_id: turnId,
        terminal_authority_status: "authorized_by_helix_provider_candidate_bridge",
        provider_terminal_candidate_ref: candidateRef,
        provider_terminal_candidate: candidate,
        evidence_reentry_required: true,
        normalized_observation_packet_count: 1,
        normalized_observations_ready: true,
        all_gateway_calls_succeeded: true,
        all_capability_lane_observations_succeeded: true,
        all_observations_succeeded: true,
        solver_completed: true,
        goal_satisfaction_compatible: true,
        terminal_authority_granted: true,
        final_visible_answer_authorized: true,
        terminal_answer_authority: bridgeAuthority,
        terminal_presentation: bridgePresentation,
      },
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("agent_provider_terminal_candidate");
    expect(result.source).toBe("agent_provider_terminal_candidate");
    expect(result.visible_text).toBe(answerText);
    expect(payload.terminal_error_code).toBeUndefined();
    expect(payload.typed_failure).toBeUndefined();
    expect(payload.final_status).toBe("final_answer");
    expect(payload.selected_final_answer).toBe(answerText);
    expect(payload.terminal_answer_authority).toMatchObject({
      terminal_kind: "answer",
      terminal_artifact_kind: "agent_provider_terminal_candidate",
      final_answer_source: "agent_provider_terminal_candidate",
      terminal_text_preview: answerText,
    });
    expect(payload.provider_terminal_runtime_authority).toMatchObject({
      schema: "helix.provider_terminal_runtime_authority.v1",
      turn_id: turnId,
      provider_terminal_candidate_ref: candidateRef,
      selected_observation_refs: [observationRef],
      evidence_reentered: true,
      solver_completed: true,
      goal_satisfaction_compatible: true,
      server_authoritative: true,
    });
  });

  it("surfaces an authorized provider answer after a capability-lane observation product is re-entered", () => {
    const turnId = "ask:test:authorized-provider-bridge-after-capability-lane";
    const observation = {
      artifact_id: `${turnId}:capability_lane:visual_analysis.inspect_image_region:obs`,
      kind: "capability_lane_observation_packet",
      payload: {
        schema: "helix.agent_step_observation_packet.v1",
        turn_id: turnId,
        status: "succeeded",
        terminal_eligible: false,
        post_tool_model_step_required: true,
        action: "inspect_image_region",
        panel_id: "image-lens",
        capability_key: "visual_analysis.inspect_image_region",
        assistant_answer: false,
        raw_content_included: false,
      },
    };
    const observationRef = String(observation.artifact_id);
    const candidateRef = `${turnId}:agent_provider_terminal_candidate:codex:visual`;
    const answerText = "The requested discussion is on page 3; the rendered page is ready in Image Lens.";
    const candidate = {
      schema: "helix.agent_provider_terminal_candidate.v1",
      candidate_id: candidateRef,
      turn_id: turnId,
      candidate_text_preview: answerText,
      grounded_in_observation_refs: [observationRef],
      normalized_observation_refs: [observationRef],
      provider_reasoning_completed: true,
      terminal_eligible: false,
    };
    const bridgeAuthority = {
      schema: "helix.turn_terminal_authority.v1",
      turn_id: turnId,
      terminal_kind: "answer",
      terminal_artifact_kind: "agent_provider_terminal_candidate",
      final_answer_source: "agent_provider_terminal_candidate",
      terminal_item_id: candidateRef,
      server_authoritative: true,
    };
    const bridgePresentation = {
      schema: "helix.terminal_presentation.v1",
      turn_id: turnId,
      concise_text: answerText,
      terminal_artifact_kind: "agent_provider_terminal_candidate",
      final_answer_source: "agent_provider_terminal_candidate",
      terminal_authority_ref: candidateRef,
      selected_observation_refs: [observationRef],
    };
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      current_turn_artifact_ledger: [observation],
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        required_terminal_artifact_kind: "image_lens_observation_report",
        required_terminal_kind: "image_lens_observation_report",
        allowed_terminal_artifact_kinds: ["image_lens_observation_report", "typed_failure"],
      },
      canonical_goal_frame: {
        schema: "helix.canonical_goal_frame.v1",
        turn_id: turnId,
        source: "codex_provider_capability_lane_terminal_authority",
        goal_kind: "image_lens_region_inspection",
        requested_capability: "visual_analysis.inspect_image_region",
        required_terminal_kind: "image_lens_observation_report",
      },
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        turn_id: turnId,
        terminal_kind: "failure",
        terminal_artifact_kind: "typed_failure",
        final_answer_source: "typed_failure",
        server_authoritative: true,
      },
      provider_reasoning_reentry: {
        schema: "helix.provider_reasoning_reentry.v1",
        turn_id: turnId,
        status: "completed",
        evidence_reentered: true,
        solver_completed: true,
        goal_satisfaction_compatible: true,
      },
      provider_terminal_candidate: candidate,
      provider_terminal_authority_bridge: {
        schema: "helix.provider_terminal_authority_bridge.v1",
        turn_id: turnId,
        terminal_authority_status: "authorized_by_helix_provider_candidate_bridge",
        provider_terminal_candidate_ref: candidateRef,
        provider_terminal_candidate: candidate,
        evidence_reentry_required: true,
        normalized_observation_packet_count: 1,
        normalized_observations_ready: true,
        all_gateway_calls_succeeded: true,
        all_capability_lane_observations_succeeded: true,
        all_observations_succeeded: true,
        solver_completed: true,
        goal_satisfaction_compatible: true,
        terminal_authority_granted: true,
        final_visible_answer_authorized: true,
        terminal_answer_authority: bridgeAuthority,
        terminal_presentation: bridgePresentation,
      },
      terminal_candidate_rejections: [{ artifactKind: "normal_answer", reason: "missing_evidence_reentry" }],
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: [observation],
    });

    expect(result.selected_terminal_artifact_kind).toBe("agent_provider_terminal_candidate");
    expect(result.source).toBe("agent_provider_terminal_candidate");
    expect(result.visible_text).toBe(answerText);
    expect(payload.terminal_error_code).toBeUndefined();
    expect(payload.final_status).toBe("final_answer");
  });

  it("surfaces a bounded provider answer from an actionable blocked lane without relabeling the operation as succeeded", () => {
    const turnId =
      "ask:test:authorized-provider-bridge-after-actionable-blocker";
    const observationRef = `${turnId}:theory-reflection:blocked`;
    const observation = {
      artifact_id: observationRef,
      kind: "capability_lane_observation_packet",
      payload: {
        schema: "helix.agent_step_observation_packet.v1",
        turn_id: turnId,
        status: "blocked",
        capability_key: "helix_ask.reflect_theory_context",
        produced_artifact_refs: [observationRef],
        missing_requirements: [
          {
            code: "semantic_source_provenance_required",
            message:
              "Supply current-turn semantic source provenance before graph reflection.",
            repair_action: "supply_current_turn_semantic_source",
          },
        ],
        suggested_next_steps: ["repair", "ask_user"],
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      },
    };
    const candidateRef = `${turnId}:agent_provider_terminal_candidate:codex:theory`;
    const answerText =
      "The bounded procedure was evaluated; Theory Badge Graph reflection remains limited by missing current-turn semantic source provenance.";
    const candidate = {
      schema: "helix.agent_provider_terminal_candidate.v1",
      candidate_id: candidateRef,
      turn_id: turnId,
      candidate_text_preview: answerText,
      grounded_in_observation_refs: [observationRef],
      normalized_observation_refs: [observationRef],
      provider_reasoning_completed: true,
      terminal_eligible: false,
    };
    const bridgeAuthority = {
      schema: "helix.turn_terminal_authority.v1",
      turn_id: turnId,
      terminal_kind: "answer",
      terminal_artifact_kind: "agent_provider_terminal_candidate",
      final_answer_source: "agent_provider_terminal_candidate",
      terminal_item_id: candidateRef,
      server_authoritative: true,
    };
    const bridgePresentation = {
      schema: "helix.terminal_presentation.v1",
      turn_id: turnId,
      concise_text: answerText,
      terminal_artifact_kind: "agent_provider_terminal_candidate",
      final_answer_source: "agent_provider_terminal_candidate",
      terminal_authority_ref: candidateRef,
      selected_observation_refs: [observationRef],
    };
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      current_turn_artifact_ledger: [observation],
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        required_terminal_kind: "model_synthesized_answer",
        allowed_terminal_artifact_kinds: [
          "model_synthesized_answer",
          "agent_provider_terminal_candidate",
          "typed_failure",
        ],
      },
      canonical_goal_frame: {
        schema: "helix.canonical_goal_frame.v1",
        turn_id: turnId,
        source: "codex_provider_capability_lane_terminal_authority",
        goal_kind: "compound_evidence_synthesis",
        requested_capability: "theory-experiment-procedure.prepare",
        required_terminal_kind: "model_synthesized_answer",
      },
      provider_reasoning_reentry: {
        schema: "helix.provider_reasoning_reentry.v1",
        turn_id: turnId,
        status: "completed",
        evidence_reentered: true,
        solver_completed: true,
        goal_satisfaction_compatible: true,
      },
      provider_terminal_candidate: candidate,
      provider_terminal_authority_bridge: {
        schema: "helix.provider_terminal_authority_bridge.v1",
        turn_id: turnId,
        terminal_authority_status:
          "authorized_by_helix_provider_candidate_bridge",
        provider_terminal_candidate_ref: candidateRef,
        provider_terminal_candidate: candidate,
        evidence_reentry_required: true,
        normalized_observation_packet_count: 1,
        normalized_observations_ready: true,
        all_gateway_calls_succeeded: true,
        all_capability_lane_observations_succeeded: false,
        all_observations_succeeded: false,
        all_capability_lane_observations_reentry_compatible: true,
        all_observations_reentry_compatible: true,
        required_committed_subgoals_satisfied: true,
        actionable_blocked_capability_lane_observation_refs: [observationRef],
        reentered_capability_lane_observation_refs: [observationRef],
        solver_completed: true,
        goal_satisfaction_compatible: true,
        terminal_authority_granted: true,
        final_visible_answer_authorized: true,
        terminal_answer_authority: bridgeAuthority,
        terminal_presentation: bridgePresentation,
      },
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: [observation],
    });

    expect(result.selected_terminal_artifact_kind).toBe(
      "model_synthesized_answer",
    );
    expect(result.source).toBe("final_answer_draft");
    expect(result.visible_text).toBe(answerText);
    expect(payload.terminal_error_code).toBeUndefined();
    expect(payload.final_status).toBe("final_answer");
  });

  it("does not surface a capability-lane provider answer before evidence re-entry completes", () => {
    const turnId = "ask:test:blocked-provider-bridge-before-capability-lane-reentry";
    const observation = makePostToolObservation(turnId);
    const observationRef = String(observation.artifact_id);
    const candidateRef = `${turnId}:agent_provider_terminal_candidate:codex:visual`;
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      current_turn_artifact_ledger: [observation],
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        required_terminal_kind: "image_lens_observation_report",
        allowed_terminal_artifact_kinds: ["image_lens_observation_report", "typed_failure"],
      },
      canonical_goal_frame: {
        schema: "helix.canonical_goal_frame.v1",
        turn_id: turnId,
        source: "codex_provider_capability_lane_terminal_authority",
        goal_kind: "image_lens_region_inspection",
        requested_capability: "visual_analysis.inspect_image_region",
        required_terminal_kind: "image_lens_observation_report",
      },
      provider_reasoning_reentry: {
        schema: "helix.provider_reasoning_reentry.v1",
        turn_id: turnId,
        status: "pending",
        evidence_reentered: false,
        solver_completed: false,
        goal_satisfaction_compatible: false,
      },
      provider_terminal_candidate: {
        schema: "helix.agent_provider_terminal_candidate.v1",
        candidate_id: candidateRef,
        turn_id: turnId,
        candidate_text_preview: "Unsupported early answer.",
        grounded_in_observation_refs: [observationRef],
        normalized_observation_refs: [observationRef],
        provider_reasoning_completed: false,
        terminal_eligible: false,
      },
      provider_terminal_authority_bridge: {
        schema: "helix.provider_terminal_authority_bridge.v1",
        turn_id: turnId,
        terminal_authority_status: "blocked_by_observation_state",
        provider_terminal_candidate_ref: candidateRef,
        evidence_reentry_required: true,
        normalized_observation_packet_count: 0,
        normalized_observations_ready: false,
        all_gateway_calls_succeeded: true,
        all_capability_lane_observations_succeeded: true,
        all_observations_succeeded: true,
        solver_completed: false,
        goal_satisfaction_compatible: false,
        terminal_authority_granted: false,
        final_visible_answer_authorized: false,
      },
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: [observation],
    });

    expect(result.selected_terminal_artifact_kind).not.toBe("agent_provider_terminal_candidate");
    expect(payload.final_answer_source).not.toBe("agent_provider_terminal_candidate");
  });

  it("preserves a grounded provider observation blocker as a specific typed failure", () => {
    const turnId = "ask:test:grounded-provider-observation-blocker";
    const observation = makePostToolObservation(turnId);
    const observationRef = String(observation.artifact_id);
    const candidateRef = `${turnId}:agent_provider_terminal_candidate:codex:visual`;
    const blockerText = [
      "Page 2 inspection cannot be completed from the re-entered evidence.",
      `- Observation ref: \`${observationRef}\``,
      "- Extraction status: `blocked_missing_visual_extraction_fields`",
      "The current-turn packet exposes the observation reference but not its extraction payload, so asserting an equation would invent evidence.",
    ].join("\n");
    const artifacts = [observation];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      current_turn_artifact_ledger: artifacts,
      selected_final_answer: "Opening panel: Image Lens.",
      terminal_artifact_kind: "workspace_action_receipt",
      final_answer_source: "legacy_fallback",
      provider_terminal_authority_bridge: {
        schema: "helix.provider_terminal_authority_bridge.v1",
        turn_id: turnId,
        provider_terminal_candidate_ref: candidateRef,
        capability_lane_observation_refs: [observationRef],
        successful_capability_lane_observation_refs: [],
        normalized_observation_refs: [observationRef],
        all_observations_succeeded: false,
        terminal_authority_status: "blocked_by_observation_state",
        terminal_authority_granted: false,
        final_visible_answer_authorized: false,
      },
      provider_terminal_candidate: {
        schema: "helix.agent_provider_terminal_candidate.v1",
        candidate_id: candidateRef,
        turn_id: turnId,
        candidate_text_preview: blockerText,
        grounded_in_observation_refs: [observationRef],
        normalized_observation_refs: [observationRef],
        provider_reasoning_completed: true,
        terminal_eligible: false,
      },
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("typed_failure");
    expect(payload.terminal_error_code).toBe("blocked_missing_visual_extraction_fields");
    expect(payload.selected_final_answer).toBe(blockerText);
    expect(payload.typed_failure).toMatchObject({
      error_code: "blocked_missing_visual_extraction_fields",
      provider_terminal_candidate_ref: candidateRef,
      grounded_observation_refs: [observationRef],
      provider_terminal_authority_status: "blocked_by_observation_state",
    });
  });

  it("preserves a Research Library sign-in precondition as the terminal failure", () => {
    const turnId = "ask:test:research-library-profile-session-required";
    const observation = {
      artifact_id: `${turnId}:obs`,
      kind: "agent_step_observation_packet",
      payload: {
        schema: "helix.agent_step_observation_packet.v1",
        turn_id: turnId,
        capability_key: "research-library.read_document",
        status: "blocked",
        missing_requirements: [{
          code: "profile_session_required",
          message: "Sign in before reading private saved research evidence.",
          repair_action: "ask_user",
        }],
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      },
    };
    const artifacts = [observation];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      current_turn_artifact_ledger: artifacts,
      workstation_gateway_call_results: [{
        schema: "helix.workstation_tool_gateway.call_result.v1",
        ok: false,
        capability_id: "research-library.read_document",
        error: "profile_session_required",
        gateway_admission: {
          requested_capability: "research-library.read_document",
          admission_status: "blocked",
          blocked_reason: "profile_session_required",
        },
      }],
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("typed_failure");
    expect(payload.terminal_error_code).toBe("profile_session_required");
    expect(payload.selected_final_answer).toBe(
      "Sign in to access the private Research Library, then retry this request.",
    );
    expect(payload.typed_failure).toMatchObject({
      error_code: "profile_session_required",
      first_broken_rail: "tool_admission",
      repair_target: "account_session",
      selected_capability: "research-library.read_document",
    });
  });

  it("surfaces a typed environment connector refusal instead of masking it as a missing itinerary observation", () => {
    const turnId = "ask:test:environment-connector-permission-revoked";
    const capability = "com.casimirbot.minecraft.inventory.check";
    const failureText =
      "Environment probes require an authenticated external Agent API continuation.";
    const genericContinuationText =
      "I could not complete this turn yet because solver continuation is required before terminal answer selection.";
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
      terminal_error_code: "solver_continuation_pending",
      terminal_failure_text: genericContinuationText,
      typed_failure: {
        schema: "helix.typed_failure.v1",
        error_code: "solver_continuation_pending",
        message: genericContinuationText,
        text: genericContinuationText,
        answer_text: genericContinuationText,
        assistant_answer: false,
        raw_content_included: false,
      },
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        source_target: "live_environment",
        allowed_terminal_artifact_kinds: [
          "model_synthesized_answer",
          "typed_failure",
        ],
      },
      canonical_goal_frame: {
        goal_kind: "live_environment",
        required_terminal_kind: "model_synthesized_answer",
      },
      capability_itinerary: {
        schema: "helix.capability_itinerary.v1",
        prompt_shape: "single_tool",
        relevant_tool_families: ["live_environment"],
        terminal_success_criteria: {
          required_observation_families: ["live_environment"],
          required_capabilities: [capability],
          requires_post_observation_synthesis: true,
        },
        assistant_answer: false,
        raw_content_included: false,
      },
      workstation_gateway_call_results: [
        {
          schema: "helix.workstation_tool_gateway.call_result.v1",
          ok: false,
          capability_id: capability,
          error: "permission_revoked",
          gateway_admission: {
            requested_capability: capability,
            admission_status: "blocked",
            admission_reason: "authenticated_environment_probe_blocked",
            blocked_reason: "permission_revoked",
          },
          observation: {
            schema: "helix.environment_connector.probe_observation.v1",
            capability_id: capability,
            outcome: "permission_revoked",
            summary: failureText,
            reentry_required: true,
            answer_authority: false,
            assistant_answer: false,
            terminal_eligible: false,
            raw_content_included: false,
          },
          terminal_eligible: false,
          post_tool_model_step_required: true,
          assistant_answer: false,
          raw_content_included: false,
        },
      ],
      current_turn_artifact_ledger: [],
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: [],
    });

    expect(result.selected_terminal_artifact_kind).toBe("typed_failure");
    expect(result.selected_terminal_artifact_ref).toMatch(/typed_failure/);
    expect(payload.terminal_error_code).toBe("permission_revoked");
    expect(payload.selected_final_answer).toBe(failureText);
    expect(payload.selected_final_answer).not.toContain(
      "required itinerary observations are missing",
    );
    expect(payload.typed_failure).toMatchObject({
      error_code: "permission_revoked",
      first_broken_rail: "tool_admission",
      repair_target: "external_agent_api_authentication",
      selected_capability: capability,
    });
    expect(payload.terminal_answer_authority).toMatchObject({
      terminal_kind: "failure",
      terminal_artifact_kind: "typed_failure",
      server_authoritative: true,
    });
  });

  it("turns an exact capability absent from the governed model tool surface into an actionable typed limitation", () => {
    const turnId = "ask:test:environment-capability-unavailable";
    const capability =
      "com.casimirbot.minecraft.container_contents.read";
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        source_target: "live_environment",
        allowed_terminal_artifact_kinds: [
          "model_synthesized_answer",
          "typed_failure",
        ],
      },
      canonical_goal_frame: {
        goal_kind: "live_environment",
        required_terminal_kind: "model_synthesized_answer",
      },
      tool_call_admission_decision: {
        schema: "helix.tool_call_admission_decision.v1",
        requested_capability: capability,
        mandatory_next_tool_name: capability,
        selected_capability: capability,
        executed_capability: null,
      },
      codex_native_provider_bridge: {
        schema: "helix.codex_native_provider_bridge.v1",
        status: "fallback_required",
        fallback_reason: "native_admitted_capability_set_empty",
        native_workstation_turn: {
          model_visible_tools: [],
          executed_tools: [],
          account_locked_tools: [],
          compatibility_fallback_reason:
            "native_admitted_capability_set_empty",
        },
      },
      capability_itinerary: {
        schema: "helix.capability_itinerary.v1",
        prompt_shape: "single_tool",
        relevant_tool_families: ["live_environment"],
        terminal_success_criteria: {
          required_observation_families: ["live_environment"],
          required_capabilities: [capability],
          requires_post_observation_synthesis: true,
        },
        assistant_answer: false,
        raw_content_included: false,
      },
      current_turn_artifact_ledger: [],
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: [],
    });

    expect(result.selected_terminal_artifact_kind).toBe("typed_failure");
    expect(payload.terminal_error_code).toBe("capability_unavailable");
    expect(payload.selected_final_answer).toContain(capability);
    expect(payload.selected_final_answer).toContain("not available");
    expect(payload.selected_final_answer).toContain(
      "connector implementation",
    );
    expect(payload.typed_failure).toMatchObject({
      error_code: "capability_unavailable",
      requested_capability: capability,
      first_broken_rail: "capability_execution",
      repair_target: "connector_capability_implementation",
    });
  });

  it("preserves an exact account-policy gateway failure instead of relabeling it capability unavailable", () => {
    const turnId = "ask:test:brokerage-account-policy-continuity";
    const capability = "environment.brokerage.robinhood.read";
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "helix-ask:desktop:test",
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        source_target: "live_environment",
        allowed_terminal_artifact_kinds: [
          "model_synthesized_answer",
          "typed_failure",
        ],
      },
      canonical_goal_frame: {
        goal_kind: "live_environment",
        required_terminal_kind: "model_synthesized_answer",
      },
      tool_call_admission_decision: {
        schema: "helix.tool_call_admission_decision.v1",
        source_target: "live_environment",
        required: true,
        admitted_tool_families: ["live_environment"],
      },
      codex_native_provider_bridge: {
        schema: "helix.codex_native_provider_bridge.v1",
        status: "fallback_required",
        fallback_reason: "native_admitted_capability_set_empty",
        native_workstation_turn: {
          model_visible_tools: [capability],
          executed_tools: [capability],
          account_locked_tools: [],
          compatibility_fallback_reason:
            "native_admitted_capability_set_empty",
        },
      },
      capability_itinerary: {
        schema: "helix.capability_itinerary.v1",
        prompt_shape: "source_backed",
        relevant_tool_families: ["live_environment"],
        terminal_success_criteria: {
          required_observation_families: ["live_environment"],
          requires_post_observation_synthesis: true,
        },
      },
      workstation_gateway_call_results: [
        {
          capability_id: capability,
          ok: false,
          error: "capability_outside_account_policy",
          gateway_admission: {
            admission_status: "blocked",
            blocked_reason: "capability_outside_account_policy",
          },
          observation: {
            schema:
              "helix.workstation_tool_gateway.account_policy_observation.v1",
            status: "blocked",
            blocked_reason: "capability_outside_account_policy",
            terminal_eligible: false,
            assistant_answer: false,
          },
          tool_followup_decision: {
            next_action: "ask_user",
            reason: "capability_outside_account_policy",
            observation_summary:
              "Workstation gateway blocked environment.brokerage.robinhood.read: capability_outside_account_policy.",
          },
        },
      ],
      current_turn_artifact_ledger: [],
    };

    applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "helix-ask:desktop:test",
      payload,
      artifactLedger: [],
    });

    expect(payload.terminal_error_code).toBe(
      "capability_outside_account_policy",
    );
    expect(payload.terminal_error_code).not.toBe("capability_unavailable");
    expect(payload.selected_final_answer).toContain(
      "capability_outside_account_policy",
    );
    expect(payload.typed_failure).toMatchObject({
      error_code: "capability_outside_account_policy",
      first_broken_rail: "tool_admission",
      repair_target: "account_session",
      selected_capability: capability,
    });
  });

  it("turns a required capability family with no governed model tool into an actionable typed limitation", () => {
    const turnId = "ask:test:capability-family-unavailable";
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        source_target: "live_pipeline",
        allowed_terminal_artifact_kinds: [
          "workstation_tool_evaluation",
          "typed_failure",
        ],
      },
      source_target_intent: {
        schema: "helix.ask_source_target_intent.v1",
        target_source: "live_pipeline",
        target_kind: "runtime_evidence",
        strength: "hard",
        must_enter_backend_ask: true,
        allow_client_shortcut: false,
        allow_no_tool_direct: false,
      },
      canonical_goal_frame: {
        goal_kind: "live_environment",
        required_terminal_kind: "workstation_tool_evaluation",
      },
      tool_call_admission_decision: {
        schema: "helix.tool_call_admission_decision.v1",
        required: true,
        admitted_tool_families: ["live_pipeline"],
      },
      codex_native_provider_bridge: {
        schema: "helix.codex_native_provider_bridge.v1",
        status: "fallback_required",
        fallback_reason: "native_admitted_capability_set_empty",
        native_workstation_turn: {
          model_visible_tools: [],
          executed_tools: [],
          account_locked_tools: [],
          compatibility_fallback_reason:
            "native_admitted_capability_set_empty",
        },
      },
      capability_itinerary: {
        schema: "helix.capability_itinerary.v1",
        prompt_shape: "source_backed",
        relevant_tool_families: ["live_pipeline"],
        terminal_success_criteria: {
          required_observation_families: ["live_pipeline"],
          requires_post_observation_synthesis: true,
        },
        assistant_answer: false,
        raw_content_included: false,
      },
      current_turn_artifact_ledger: [],
      loop_parity_trace: {
        schema: "helix.loop_parity_trace.v1",
        selected_route: "/ask/turn",
        observations_created: [],
        short_circuit_risk_flags: [
          "route_contract_missing",
          "route_authority_missing",
        ],
      },
      ask_turn_solver_trace: {
        schema: "helix.ask_turn_solver_trace.v1",
        route_authority_ok: false,
        solver_risk_flags: ["terminal_authority_before_solver_completion"],
        solver_short_circuit_flags: [
          "terminal_authority_before_solver_completion",
        ],
        final_arbitration: {
          terminal_artifact_kind: "unknown",
          final_answer_source: "unknown",
          remaining_uncertainty: [
            "terminal_authority_before_solver_completion",
          ],
        },
      },
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: [],
    });

    expect(result.selected_terminal_artifact_kind).toBe("typed_failure");
    expect(payload.terminal_error_code).toBe("capability_unavailable");
    expect(payload.selected_final_answer).toContain("live_pipeline");
    expect(payload.typed_failure).toMatchObject({
      error_code: "capability_unavailable",
      requested_capability: "live_pipeline",
      first_broken_rail: "capability_execution",
      repair_target: "connector_capability_implementation",
    });
    expect(
      (payload.route_authority_audit as Record<string, unknown>)
        .route_authority_ok,
    ).toBe(true);
    expect(
      (
        payload.loop_parity_trace as {
          short_circuit_risk_flags: string[];
        }
      ).short_circuit_risk_flags,
    ).toEqual([]);
    expect(
      (
        payload.ask_turn_solver_trace as {
          solver_short_circuit_flags: string[];
        }
      ).solver_short_circuit_flags,
    ).toEqual([]);
  });

  it("rejects stale no-context model fallbacks after live-source observations exist", () => {
    const turnId = "ask:test:stale-live-source-fallback";
    const staleText = "I am unable to provide context because no observations are available.";
    const artifacts = [
      {
        artifact_id: `${turnId}:processed_packet`,
        turn_id: turnId,
        kind: "live_environment_tool_observation",
        payload: {
          tool_name: "live_env.read_processed_live_source_mail",
          observation: {
            artifactId: "stage_play_processed_mail_packet",
            schemaVersion: "stage_play_processed_mail_packet/v1",
            recommendedNext: "request_voice_callout",
          },
        },
      },
      {
        artifact_id: `${turnId}:final_answer_draft`,
        kind: "final_answer_draft",
        payload: {
          schema: "helix.final_answer_draft.v1",
          text: staleText,
          authority: "llm_post_observation_composer",
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        allowed_terminal_artifact_kinds: ["model_synthesized_answer", "typed_failure"],
        forbidden_terminal_artifact_kinds: ["live_environment_tool_observation", "tool_receipt"],
        assistant_answer: false,
        raw_content_included: false,
      },
      canonical_goal_frame: {
        goal_kind: "live_environment_review",
        required_terminal_kind: "model_synthesized_answer",
      },
      current_turn_artifact_ledger: artifacts,
      selected_final_answer: staleText,
      terminal_artifact_kind: "model_synthesized_answer",
      final_answer_source: "final_answer_draft",
      goal_satisfaction_evaluation: {
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("typed_failure");
    expect(result.visible_text).not.toBe(staleText);
    expect(result.rejected_candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "model_synthesized_answer",
          reason: "composer_claimed_no_observations_but_receipts_exist",
        }),
      ]),
    );
    expect(result.audit?.rejectedCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          artifactKind: "model_synthesized_answer",
          reason: "stale_model_only_after_observation",
        }),
      ]),
    );
    expect(payload.terminal_candidate_rejections).toEqual(result.audit?.rejectedCandidates);
    expect(["post_tool_model_step_missing", "terminal_boundary_ineligible"]).toContain(payload.terminal_error_code);
    expect(payload.selected_final_answer).not.toBe(staleText);
  });

  it("fails closed when a compound itinerary lacks required research and locator observations", () => {
    const turnId = "ask:test:compound-itinerary-missing-observations";
    const draftText = "Generic model-only answer with citations and badge names.";
    const artifacts = [
      {
        artifact_id: `${turnId}:final_answer_draft`,
        kind: "final_answer_draft",
        payload: {
          schema: "helix.final_answer_draft.v1",
          text: draftText,
          authority: "llm_post_observation_composer",
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        allowed_terminal_artifact_kinds: ["model_synthesized_answer", "typed_failure"],
        forbidden_terminal_artifact_kinds: ["workspace_action_receipt", "agent_step_observation_packet"],
        assistant_answer: false,
        raw_content_included: false,
      },
      canonical_goal_frame: {
        goal_kind: "compound_research_locator",
        required_terminal_kind: "model_synthesized_answer",
      },
      capability_itinerary: {
        schema: "helix.capability_itinerary.v1",
        prompt_shape: "compound_tool",
        relevant_tool_families: ["scholarly_research", "theory_locator"],
        terminal_success_criteria: {
          required_observation_families: ["scholarly_research", "theory_locator"],
          requires_post_observation_synthesis: true,
        },
        assistant_answer: false,
        raw_content_included: false,
      },
      current_turn_artifact_ledger: artifacts,
      selected_final_answer: draftText,
      terminal_artifact_kind: "model_synthesized_answer",
      final_answer_source: "final_answer_draft",
      goal_satisfaction_evaluation: {
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("typed_failure");
    expect(result.selectedArtifactKind).toBe("typed_failure");
    expect(result.source).toBe("typed_failure");
    expect(result.visible_text).toContain("required itinerary observations are missing");
    expect(result.visible_text).toContain("scholarly_research");
    expect(result.visible_text).toContain("theory_locator");
    expect(result.rejected_candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "model_synthesized_answer",
          reason: "missing_required_observation",
        }),
      ]),
    );
    expect(payload.terminal_artifact_kind).toBe("typed_failure");
    expect(payload.final_answer_source).toBe("typed_failure");
    expect((payload.terminal_answer_authority as Record<string, unknown>).terminal_artifact_kind).toBe("typed_failure");
    expect(payload.selected_final_answer).not.toBe(draftText);
    expect(payload.capability_itinerary_execution_state).toMatchObject({
      schema: "helix.capability_itinerary_execution_state.v1",
      required_observation_families: ["scholarly_research", "theory_locator"],
      observed_families: [],
      missing_observation_families: ["scholarly_research", "theory_locator"],
      complete: false,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("uses late payload-ledger evidence when the explicit terminal ledger snapshot is stale", () => {
    const turnId = "ask:test:late-payload-ledger-itinerary-evidence";
    const observationRef = `${turnId}:scholarly_research_observation`;
    const draftText =
      "The current-turn research observation supports the requested finding ([source](https://example.com/research)).";
    const payloadArtifacts = [
      {
        artifact_id: observationRef,
        kind: "scholarly_research_observation",
        payload: {
          schema: "helix.scholarly_research_observation.v1",
          turn_id: turnId,
          status: "completed",
          capability_key: "scholarly-research.lookup_papers",
          papers: [{ title: "Current-turn research result" }],
        },
      },
      {
        artifact_id: `${turnId}:final_answer_draft`,
        kind: "final_answer_draft",
        payload: {
          schema: "helix.final_answer_draft.v1",
          text: draftText,
          support_refs: [observationRef],
          artifact_refs: [observationRef],
          authority: "llm_post_observation_composer",
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      active_prompt: "Find current research on the requested topic and summarize it.",
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        source_target: "scholarly_research",
        allowed_terminal_artifact_kinds: [
          "scholarly_research_answer",
          "typed_failure",
        ],
      },
      canonical_goal_frame: {
        goal_kind: "scholarly_research_lookup",
        required_terminal_kind: "scholarly_research_answer",
      },
      capability_itinerary: {
        schema: "helix.capability_itinerary.v1",
        prompt_shape: "source_backed",
        relevant_tool_families: ["scholarly_research"],
        terminal_success_criteria: {
          required_observation_families: ["scholarly_research"],
          requires_post_observation_synthesis: true,
        },
      },
      current_turn_artifact_ledger: payloadArtifacts,
      selected_final_answer: draftText,
      terminal_artifact_kind: "scholarly_research_answer",
      final_answer_source: "final_answer_draft",
      goal_satisfaction_evaluation: {
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      // This intentionally models the earlier snapshot that previously won
      // over the successful late observation stored on the payload.
      artifactLedger: [],
    });

    expect(payload.capability_itinerary_execution_state).toMatchObject({
      complete: true,
      observed_families: ["scholarly_research"],
      missing_observation_families: [],
    });
    expect(payload.terminal_error_code).not.toBe(
      "capability_itinerary_observations_missing",
    );
    expect(result.visible_text).not.toContain(
      "required itinerary observations are missing",
    );
  });

  it("preserves a grounded Codex synthesis after repaired action evidence and an exact post-action read", () => {
    const turnId = "ask:test:guardian-repair-read-act-read-terminal";
    const status = "com.casimirbot.minecraft.actor.status.read";
    const action = "com.casimirbot.minecraft.player.guardian.execute";
    const beforeObservationRef = `${turnId}:normalized:status:1`;
    const actionObservationRef = `${turnId}:normalized:guardian:5`;
    const afterObservationRef = `${turnId}:normalized:status:6`;
    const beforeGatewayRef = `${turnId}:gateway:status:1`;
    const failedActionGatewayRef = `${turnId}:gateway:guardian:2:failed`;
    const actionGatewayRef = `${turnId}:gateway:guardian:5:succeeded`;
    const afterGatewayRef = `${turnId}:gateway:status:6`;
    const draftRef = `${turnId}:final_answer_draft`;
    const draftText =
      "The repaired guardian action succeeded, and the post-action status read confirms the player remains in a recoverable state.";
    const normalizedObservation = (
      capability: string,
      ref: string,
      gatewayRef: string,
    ) => ({
      artifact_id: ref,
      producer_item_id: `${gatewayRef}:call`,
      kind: "live_environment_observation",
      turn_id: turnId,
      source_scope: "current_turn_context",
      capability_key: capability,
      source_capability_id: capability,
      provider_gateway_observation_ref: gatewayRef,
      provider_gateway_packet_refs: [gatewayRef],
      status: "succeeded",
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      payload: {
        schema: "helix.live_environment_observation.v1",
        status: "succeeded",
        capability_key: capability,
        source_capability_id: capability,
        provider_gateway_observation_ref: gatewayRef,
        provider_gateway_packet_refs: [gatewayRef],
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      },
    });
    const gatewayPacket = (
      capability: string,
      ref: string,
      iteration: number,
      statusValue: string,
    ) => ({
      artifact_id: ref,
      producer_item_id: `${ref}:call`,
      kind: "provider_gateway_observation_packet",
      turn_id: turnId,
      capability_key: capability,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      payload: {
        schema: "helix.agent_step_observation_packet.v1",
        turn_id: turnId,
        iteration,
        capability_key: capability,
        status: statusValue,
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      },
    });
    const artifacts = [
      // The production terminal ledger stores normalized observations first.
      normalizedObservation(status, beforeObservationRef, beforeGatewayRef),
      normalizedObservation(action, actionObservationRef, actionGatewayRef),
      normalizedObservation(status, afterObservationRef, afterGatewayRef),
      gatewayPacket(status, beforeGatewayRef, 1, "succeeded"),
      gatewayPacket(action, failedActionGatewayRef, 2, "failed"),
      gatewayPacket(action, actionGatewayRef, 5, "succeeded"),
      gatewayPacket(status, afterGatewayRef, 6, "succeeded"),
      {
        artifact_id: draftRef,
        kind: "final_answer_draft",
        turn_id: turnId,
        payload: {
          schema: "helix.final_answer_draft.v1",
          artifact_id: draftRef,
          turn_id: turnId,
          text: draftText,
          answer_text: draftText,
          support_refs: [
            beforeObservationRef,
            actionObservationRef,
            afterObservationRef,
          ],
          subgoal_observation_refs: [
            beforeObservationRef,
            actionObservationRef,
            afterObservationRef,
          ],
          authority: "llm_post_observation_composer",
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      active_prompt:
        "Read my status, run the bounded guardian, read my status again, and report the result.",
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        source_target: "live_environment",
        allowed_terminal_artifact_kinds: [
          "model_synthesized_answer",
          "typed_failure",
        ],
      },
      canonical_goal_frame: {
        goal_kind: "compound_evidence_synthesis",
        required_terminal_kind: "model_synthesized_answer",
      },
      capability_itinerary: {
        schema: "helix.capability_itinerary.v1",
        turn_id: turnId,
        prompt_shape: "compound_tool",
        relevant_tool_families: ["live_environment"],
        terminal_success_criteria: {
          required_observation_families: ["live_environment"],
          required_capabilities: [status],
          required_capability_any_of_groups: [{
            group_id: "minecraft.player_embodiment.action",
            capability_ids: [action],
          }],
          requires_post_observation_synthesis: true,
        },
        compound_capability_contract: {
          subgoals: [{
            subgoal_id: "planned:post-status",
            requested_capability: status,
            runtime_capability: status,
            required_observation_kinds: ["live_environment_observation"],
            observation_after_capability_any_of_group_ids: [
              "minecraft.player_embodiment.action",
            ],
            mandatory: true,
          }],
        },
      },
      compound_capability_contract: {
        source: "codex_provider_call_occurrence_normalization",
        subgoal_identity_policy: "provider_call_occurrence",
        rail_status: "satisfied",
        subgoals: [
          {
            subgoal_id: "current:status:before",
            order: 1,
            requested_capability: status,
            runtime_capability: status,
            capability_occurrence: 1,
            observation_ref: beforeObservationRef,
            observation_refs: [beforeObservationRef],
            required_observation_kinds: ["live_environment_observation"],
            satisfaction: "satisfied",
            satisfied: true,
          },
          {
            subgoal_id: "current:guardian",
            order: 2,
            requested_capability: action,
            runtime_capability: action,
            capability_occurrence: 1,
            observation_ref: actionObservationRef,
            observation_refs: [actionObservationRef],
            required_observation_kinds: ["live_environment_observation"],
            satisfaction: "satisfied",
            satisfied: true,
          },
          {
            subgoal_id: "current:status:after",
            order: 3,
            requested_capability: status,
            runtime_capability: status,
            capability_occurrence: 2,
            observation_ref: afterObservationRef,
            observation_refs: [afterObservationRef],
            required_observation_kinds: ["live_environment_observation"],
            satisfaction: "satisfied",
            satisfied: true,
          },
        ],
      },
      current_turn_artifact_ledger: artifacts,
      selected_final_answer: draftText,
      terminal_artifact_kind: "model_synthesized_answer",
      final_answer_source: "final_answer_draft",
      goal_satisfaction_evaluation: {
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: artifacts,
    });

    expect(payload.capability_itinerary_execution_state).toMatchObject({
      complete: true,
      missing_compound_subgoal_ids: [],
      missing_required_capabilities: [],
      missing_temporal_postconditions: [],
    });
    expect(payload.terminal_error_code).not.toBe(
      "capability_itinerary_observations_missing",
    );
    expect(result.selected_terminal_artifact_kind).toBe(
      "compound_evidence_synthesis_answer",
    );
    expect(result.visible_text).toBe(draftText);
    expect(artifacts).toContainEqual(
      expect.objectContaining({ artifact_id: failedActionGatewayRef }),
    );
  });

  it("preserves a required gateway policy rejection instead of replacing it with a generic missing-observation failure", () => {
    const turnId = "ask:test:scientific-evidence-policy-rejection";
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        allowed_terminal_artifact_kinds: [
          "model_synthesized_answer",
          "typed_failure",
        ],
      },
      canonical_goal_frame: {
        goal_kind: "model_only_concept",
        required_terminal_kind: "direct_answer_text",
      },
      capability_itinerary: {
        schema: "helix.capability_itinerary.v1",
        prompt_shape: "single_tool",
        admitted_tool_families: ["theory_locator"],
        terminal_success_criteria: {
          required_observation_families: ["theory_locator"],
          required_capabilities: [
            "scientific-evidence-closure.prepare",
          ],
          requires_post_observation_synthesis: true,
        },
      },
      capability_itinerary_execution_state: {
        schema: "helix.capability_itinerary_execution_state.v1",
        missing_required_capabilities: [
          "scientific-evidence-closure.prepare",
        ],
        complete: false,
      },
      workstation_gateway_call_results: [
        {
          ok: false,
          capability_id: "scientific-evidence-closure.prepare",
          error:
            "scientific_evidence_intervention_value_not_permitted",
          gateway_admission: {
            admission_status: "admitted",
          },
          observation: {
            schema:
              "casimir.scientific_evidence_execution_plan.observation.v1",
            status: "blocked",
            issues: [
              "scientific_evidence_intervention_value_not_permitted",
            ],
            terminal_eligible: false,
            assistant_answer: false,
          },
          tool_followup_decision: {
            next_action: "ask_user",
            reason:
              "scientific_evidence_intervention_value_not_permitted",
            observation_summary:
              "The requested intervention value is outside the exact enrolled value set.",
          },
        },
      ],
      current_turn_artifact_ledger: [],
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: [],
    });

    expect(result.selected_terminal_artifact_kind).toBe("typed_failure");
    expect(payload.terminal_error_code).toBe(
      "scientific_evidence_intervention_value_not_permitted",
    );
    expect(payload.selected_final_answer).toBe(
      "The requested intervention value is outside the exact enrolled value set.",
    );
    expect(payload.typed_failure).toMatchObject({
      error_code:
        "scientific_evidence_intervention_value_not_permitted",
      first_broken_rail: "capability_execution",
      repair_target: "subgoal_argument_extraction",
      selected_capability: "scientific-evidence-closure.prepare",
    });
  });

  it("derives a fail-closed itinerary from a committed source-backed route", () => {
    const turnId = "ask:test:committed-scholarly-route-missing-observation";
    const draftText = "A plausible bibliography produced without a scholarly observation.";
    const artifacts = [{
      artifact_id: `${turnId}:final_answer_draft`,
      kind: "final_answer_draft",
      payload: {
        schema: "helix.final_answer_draft.v1",
        text: draftText,
        authority: "llm_post_observation_composer",
      },
    }];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      committed_ask_route: {
        schema: "helix.committed_ask_route.v1",
        turn_id: turnId,
        canonical_goal: {
          goal_kind: "scholarly_research_lookup",
          required_terminal_kind: "scholarly_research_answer",
          allowed_terminal_artifact_kinds: ["scholarly_research_answer", "typed_failure"],
          forbidden_terminal_artifact_kinds: ["direct_answer_text"],
        },
        route: {
          selected_route: "/ask",
          source_target: "scholarly_research",
          target_kind: "scholarly_research",
          route_reason: "scholarly_research_source_admission",
          strength: "hard",
        },
        capability_policy: {
          allowed_tool_families: ["scholarly_research"],
          suppressed_tool_families: [],
          required_capability_families: ["scholarly_research"],
          mutating_families_allowed: false,
        },
        terminal_product: {
          terminal_authority_required: true,
          evidence_reentry_required: true,
          followup_reasoning_required: true,
          required_terminal_product: "scholarly_research_answer",
        },
      },
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        source_target: "scholarly_research",
        allowed_terminal_artifact_kinds: ["scholarly_research_answer", "typed_failure"],
      },
      canonical_goal_frame: {
        goal_kind: "scholarly_research_lookup",
        required_terminal_kind: "scholarly_research_answer",
      },
      current_turn_artifact_ledger: artifacts,
      selected_final_answer: draftText,
      terminal_artifact_kind: "agent_provider_terminal_candidate",
      final_answer_source: "agent_provider_terminal_candidate",
      goal_satisfaction_evaluation: {
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("typed_failure");
    expect(payload.terminal_error_code).toBe("capability_itinerary_observations_missing");
    expect(payload.selected_final_answer).not.toBe(draftText);
    expect(payload.capability_itinerary).toMatchObject({
      schema: "helix.capability_itinerary.v1",
      prompt_shape: "source_backed",
      source: "committed_ask_route_terminal_fallback",
      terminal_success_criteria: {
        required_observation_families: ["scholarly_research"],
        requires_post_observation_synthesis: true,
      },
    });
    expect(payload.capability_itinerary_execution_state).toMatchObject({
      applies: true,
      observed_families: [],
      missing_observation_families: ["scholarly_research"],
      complete: false,
    });
  });

  it("fails closed when a compound itinerary still has an unsatisfied subgoal", () => {
    const turnId = "ask:test:compound-subgoal-terminal-gate";
    const draftText = "Workspace status was inspected, so this draft tries to answer before calculator execution.";
    const artifacts = [
      {
        artifact_id: `${turnId}:runtime_tool_call:1`,
        kind: "runtime_tool_call",
        payload: {
          call_id: `${turnId}:runtime_tool_call:1`,
          capability_key: "workspace_os.status",
          args: {},
        },
      },
      {
        artifact_id: `${turnId}:runtime_tool_call:1:runtime_tool_observation`,
        kind: "runtime_tool_observation",
        payload: {
          call_id: `${turnId}:runtime_tool_call:1`,
          capability_key: "workspace_os.status",
          status: "completed",
        },
      },
      {
        artifact_id: `${turnId}:workspace_os_status_observation`,
        kind: "workspace_os_status_observation",
        payload: {
          schema: "helix.workspace_os_status_observation.v1",
          summary: { available: 1 },
        },
      },
      {
        artifact_id: `${turnId}:final_answer_draft`,
        kind: "final_answer_draft",
        payload: {
          schema: "helix.final_answer_draft.v1",
          text: draftText,
          authority: "llm_post_observation_composer",
        },
      },
    ];
    const missingCalculatorSubgoalId =
      `${turnId}:compound_capability_subgoal:2:scientific-calculator_solve_expression`;
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        allowed_terminal_artifact_kinds: ["model_synthesized_answer", "typed_failure"],
        forbidden_terminal_artifact_kinds: ["workspace_action_receipt", "agent_step_observation_packet"],
        assistant_answer: false,
        raw_content_included: false,
      },
      canonical_goal_frame: {
        goal_kind: "compound_tool",
        required_terminal_kind: "model_synthesized_answer",
      },
      capability_itinerary: {
        schema: "helix.capability_itinerary.v1",
        prompt_shape: "compound_tool",
        relevant_tool_families: ["workspace_diagnostic", "calculator"],
        terminal_success_criteria: {
          required_observation_families: ["workspace_diagnostic", "calculator"],
          required_capabilities: ["workspace_os.status", "scientific-calculator.solve_expression"],
          requires_post_observation_synthesis: true,
        },
        compound_capability_contract: {
          schema: "helix.compound_capability_contract.v1",
          turn_id: turnId,
          prompt_shape: "compound_capability",
          requires_all_subgoals: true,
          terminal_policy: "synthesize_from_satisfied_subgoal_observations",
          subgoals: [
            {
              subgoal_id: `${turnId}:compound_capability_subgoal:1:workspace_os_status`,
              order: 1,
              requested_capability: "workspace_os.status",
              runtime_capability: "workspace_os.status",
              required_observation_kinds: ["workspace_os_status_observation"],
              allowed_substitutions: [],
              args_hint: {},
            },
            {
              subgoal_id: missingCalculatorSubgoalId,
              order: 2,
              requested_capability: "scientific-calculator.solve_expression",
              runtime_capability: "scientific-calculator.solve_expression",
              required_observation_kinds: ["calculator_receipt", "workstation_tool_evaluation"],
              allowed_substitutions: [],
              args_hint: { latex: "2+2", expression: "2+2" },
            },
          ],
          assistant_answer: false,
          raw_content_included: false,
        },
        assistant_answer: false,
        raw_content_included: false,
      },
      current_turn_artifact_ledger: artifacts,
      selected_final_answer: draftText,
      terminal_artifact_kind: "model_synthesized_answer",
      final_answer_source: "final_answer_draft",
      goal_satisfaction_evaluation: {
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("typed_failure");
    expect(result.visible_text).toContain("scientific-calculator.solve_expression");
    expect(payload.capability_itinerary_execution_state).toMatchObject({
      complete: false,
      missing_required_capabilities: ["scientific-calculator.solve_expression"],
      next_missing_subgoal_id: missingCalculatorSubgoalId,
    });
    expect(payload.selected_final_answer).not.toBe(draftText);
  });

  it("does not terminalize a provider answer from a nearby capability while one exact G6 subgoal is incomplete", () => {
    const turnId = "ask:test:g6-single-exact-capability-terminal-gate";
    const goalId =
      "environment_durable_goal:ef49540b-0bab-4857-837f-c2f449b08585";
    const subgoalId =
      `${turnId}:compound_capability_subgoal:1:com_casimirbot_environment_reasoning_role_inspect`;
    const wrongObservationRef =
      `${turnId}:workstation_gateway:com.casimirbot.environment.durable_goal.inspect:wrong`;
    const candidateRef =
      `${turnId}:agent_provider_terminal_candidate:codex:wrong-capability`;
    const wrongAnswer =
      "The durable goal has no attempts, so no G6 proposal was selected.";
    const artifacts = [
      {
        artifact_id: wrongObservationRef,
        kind: "provider_gateway_observation_packet",
        payload: {
          schema: "helix.agent_step_observation_packet.v1",
          turn_id: turnId,
          capability_key:
            "com.casimirbot.environment.durable_goal.inspect",
          status: "succeeded",
          observation: {
            schema: "helix.environment_durable_goal_observation.v1",
            goal_id: goalId,
          },
          post_tool_model_step_required: true,
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      current_turn_artifact_ledger: artifacts,
      selected_final_answer: wrongAnswer,
      answer: wrongAnswer,
      text: wrongAnswer,
      final_answer_source: "agent_provider_terminal_candidate",
      terminal_artifact_kind: "agent_provider_terminal_candidate",
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        source_target: "live_environment",
        allowed_terminal_artifact_kinds: [
          "agent_provider_terminal_candidate",
          "model_synthesized_answer",
          "typed_failure",
        ],
      },
      canonical_goal_frame: {
        schema: "helix.canonical_goal_frame.v1",
        goal_kind: "agent_provider_gateway_turn",
        requested_capability:
          "com.casimirbot.environment.reasoning_role.inspect",
        required_terminal_kind: "agent_provider_terminal_candidate",
        allowed_terminal_artifact_kinds: [
          "agent_provider_terminal_candidate",
          "typed_failure",
        ],
      },
      capability_itinerary: {
        schema: "helix.capability_itinerary.v1",
        prompt_shape: "single_tool",
        relevant_tool_families: ["live_environment"],
        terminal_success_criteria: {
          required_observation_families: ["live_environment"],
          required_capabilities: [
            "com.casimirbot.environment.reasoning_role.inspect",
          ],
          requires_post_observation_synthesis: true,
        },
        compound_capability_contract: {
          schema: "helix.compound_capability_contract.v1",
          turn_id: turnId,
          prompt_shape: "single_capability",
          requires_all_subgoals: false,
          terminal_policy: "synthesize_from_satisfied_subgoal_observations",
          subgoals: [
            {
              subgoal_id: subgoalId,
              order: 1,
              mandatory: true,
              requested_capability:
                "com.casimirbot.environment.reasoning_role.inspect",
              runtime_capability:
                "com.casimirbot.environment.reasoning_role.inspect",
              required_args: ["goal_id"],
              optional_args: [],
              args_hint: { goal_id: goalId },
              required_observation_kinds: [
                "helix.environment_reasoning_role_observation.v1",
                "provider_gateway_observation_packet",
              ],
              allowed_substitutions: [],
            },
          ],
          assistant_answer: false,
          raw_content_included: false,
        },
      },
      provider_terminal_candidate: {
        schema: "helix.agent_provider_terminal_candidate.v1",
        candidate_id: candidateRef,
        turn_id: turnId,
        candidate_text: wrongAnswer,
        grounded_in_observation_refs: [wrongObservationRef],
        normalized_observation_refs: [wrongObservationRef],
        evidence_reentry_required: true,
        provider_reasoning_completed: true,
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      },
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        turn_id: turnId,
        terminal_kind: "answer",
        final_answer_source: "agent_provider_terminal_candidate",
        terminal_artifact_kind: "agent_provider_terminal_candidate",
        terminal_item_id: candidateRef,
        server_authoritative: true,
      },
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        turn_id: turnId,
        concise_text: wrongAnswer,
        terminal_artifact_kind: "agent_provider_terminal_candidate",
        final_answer_source: "agent_provider_terminal_candidate",
        terminal_authority_ref: candidateRef,
        selected_observation_refs: [wrongObservationRef],
      },
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("typed_failure");
    expect(payload.terminal_error_code).toBe("subgoal_observation_missing");
    expect(payload.selected_final_answer).not.toBe(wrongAnswer);
    expect(payload.compound_subgoal_terminal_failure).toMatchObject({
      subgoal_id: subgoalId,
      requested_capability:
        "com.casimirbot.environment.reasoning_role.inspect",
      first_broken_rail: "observation_artifact",
    });
    expect(payload.capability_itinerary_execution_state).toMatchObject({
      applies: true,
      complete: false,
      missing_required_capabilities: [
        "com.casimirbot.environment.reasoning_role.inspect",
      ],
    });
  });

  it("blocks compound final drafts that omit a satisfied subgoal observation ref", () => {
    const turnId = "ask:test:compound-draft-missing-subgoal-support";
    const workspaceSubgoalId = `${turnId}:compound_capability_subgoal:1:workspace_os_status`;
    const docsSubgoalId = `${turnId}:compound_capability_subgoal:2:docs-viewer_locate_in_doc`;
    const workspaceObservationRef = `${turnId}:workspace_os_status_observation`;
    const docsObservationRef = `${turnId}:doc_location_matches`;
    const draftText = "Workspace status was available, and the requested document anchor was located in the audit notes.";
    const artifacts = [
      {
        artifact_id: `${turnId}:runtime_tool_call:1`,
        kind: "runtime_tool_call",
        payload: {
          call_id: `${turnId}:runtime_tool_call:1`,
          capability_key: "workspace_os.status",
          compound_subgoal_id: workspaceSubgoalId,
          args: {},
        },
      },
      {
        artifact_id: `${turnId}:runtime_tool_call:1:runtime_tool_observation`,
        kind: "runtime_tool_observation",
        payload: {
          call_id: `${turnId}:runtime_tool_call:1`,
          capability_key: "workspace_os.status",
          compound_subgoal_id: workspaceSubgoalId,
          status: "completed",
        },
      },
      {
        artifact_id: workspaceObservationRef,
        kind: "workspace_os_status_observation",
        payload: {
          schema: "helix.workspace_os_status_observation.v1",
          capability_key: "workspace_os.status",
          compound_subgoal_id: workspaceSubgoalId,
          summary: { available: 18, degraded: 1 },
        },
      },
      {
        artifact_id: `${turnId}:runtime_tool_call:2`,
        kind: "runtime_tool_call",
        payload: {
          call_id: `${turnId}:runtime_tool_call:2`,
          capability_key: "docs-viewer.locate_in_doc",
          compound_subgoal_id: docsSubgoalId,
          args: { query: "terminal authority" },
        },
      },
      {
        artifact_id: `${turnId}:runtime_tool_call:2:runtime_tool_observation`,
        kind: "runtime_tool_observation",
        payload: {
          call_id: `${turnId}:runtime_tool_call:2`,
          capability_key: "docs-viewer.locate_in_doc",
          compound_subgoal_id: docsSubgoalId,
          status: "completed",
        },
      },
      {
        artifact_id: docsObservationRef,
        kind: "doc_location_matches",
        payload: {
          schema: "helix.doc_location_matches.v1",
          capability_key: "docs-viewer.locate_in_doc",
          compound_subgoal_id: docsSubgoalId,
          matches: [{ path: "docs/audits/research/helix-ask-codex-parity-model-turn-fidelity-audit-2026-06-12.md", line: 12 }],
        },
      },
      {
        artifact_id: `${turnId}:final_answer_draft`,
        kind: "final_answer_draft",
        payload: {
          schema: "helix.final_answer_draft.v1",
          text: draftText,
          support_refs: [workspaceObservationRef],
          artifact_refs: [workspaceObservationRef],
          authority: "llm_post_observation_composer",
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      active_prompt: "Use workspace_os.status, then use docs-viewer.locate_in_doc for terminal authority.",
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        source_target: "model_only",
        allowed_terminal_artifact_kinds: ["model_synthesized_answer", "typed_failure"],
        forbidden_terminal_artifact_kinds: ["workspace_action_receipt", "agent_step_observation_packet"],
        assistant_answer: false,
        raw_content_included: false,
      },
      canonical_goal_frame: {
        goal_kind: "compound_tool",
        required_terminal_kind: "model_synthesized_answer",
      },
      capability_itinerary: {
        schema: "helix.capability_itinerary.v1",
        prompt_shape: "compound_tool",
        relevant_tool_families: ["workspace_diagnostic", "docs_viewer"],
        terminal_success_criteria: {
          required_observation_families: ["workspace_diagnostic", "docs_viewer"],
          required_capabilities: ["workspace_os.status", "docs-viewer.locate_in_doc"],
          requires_post_observation_synthesis: true,
        },
        compound_capability_contract: {
          schema: "helix.compound_capability_contract.v1",
          turn_id: turnId,
          prompt_shape: "compound_capability",
          requires_all_subgoals: true,
          terminal_policy: "synthesize_from_satisfied_subgoal_observations",
          subgoals: [
            {
              subgoal_id: workspaceSubgoalId,
              order: 1,
              requested_capability: "workspace_os.status",
              runtime_capability: "workspace_os.status",
              required_observation_kinds: ["workspace_os_status_observation"],
              allowed_substitutions: [],
              args_hint: {},
            },
            {
              subgoal_id: docsSubgoalId,
              order: 2,
              requested_capability: "docs-viewer.locate_in_doc",
              runtime_capability: "docs-viewer.locate_in_doc",
              required_observation_kinds: ["doc_location_matches"],
              allowed_substitutions: [],
              args_hint: { query: "terminal authority" },
            },
          ],
          assistant_answer: false,
          raw_content_included: false,
        },
        assistant_answer: false,
        raw_content_included: false,
      },
      current_turn_artifact_ledger: artifacts,
      selected_final_answer: draftText,
      terminal_artifact_kind: "model_synthesized_answer",
      final_answer_source: "final_answer_draft",
      goal_satisfaction_evaluation: {
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("typed_failure");
    expect(payload.terminal_error_code).toBe("compound_subgoal_support_refs_missing");
    expect(payload.selected_final_answer).toContain(docsObservationRef);
    expect(payload.compound_subgoal_draft_support_coverage).toMatchObject({
      applies: true,
      ok: false,
      required_observation_refs: [workspaceObservationRef, docsObservationRef],
      draft_support_refs: [workspaceObservationRef],
      missing_observation_refs: [docsObservationRef],
    });
    expect(result.rejected_candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "model_synthesized_answer",
        source: "final_answer_draft",
        reason: "missing_required_observation",
      }),
    ]));
  });

  it("preserves compound incomplete-subgoal materializer reason in terminal mirrors", () => {
    const turnId = "ask:test:compound-incomplete-materializer-reason";
    const catalogSubgoalId = `${turnId}:compound_capability_subgoal:1:catalog`;
    const workspaceSubgoalId = `${turnId}:compound_capability_subgoal:2:workspace`;
    const catalogObservationRef = `${turnId}:capability_registry`;
    const draftRef = `${turnId}:final_answer_draft`;
    const draftText = "The capability catalog is ready, but workspace status is still missing.";
    const artifacts = [
      {
        artifact_id: catalogObservationRef,
        kind: "capability_registry",
        payload: {
          schema: "helix.capability_catalog_observation.v1",
          capability_key: "helix_ask.inspect_capability_catalog",
          compound_subgoal_id: catalogSubgoalId,
        },
      },
      {
        artifact_id: draftRef,
        kind: "final_answer_draft",
        payload: {
          schema: "helix.final_answer_draft.v1",
          text: draftText,
          answer_text: draftText,
          support_refs: [catalogObservationRef],
          artifact_refs: [catalogObservationRef],
          authority: "llm_post_observation_compound_synthesis",
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      route_product_contract: {
        source_target: "runtime_evidence",
        allowed_terminal_artifact_kinds: ["model_synthesized_answer"],
      },
      compound_capability_contract: {
        schema: "helix.compound_capability_contract.v1",
        turn_id: turnId,
        prompt_shape: "compound_capability",
        requires_all_subgoals: true,
        terminal_policy: "synthesize_from_satisfied_subgoal_observations",
        subgoals: [
          {
            subgoal_id: catalogSubgoalId,
            requested_capability: "helix_ask.inspect_capability_catalog",
          },
          {
            subgoal_id: workspaceSubgoalId,
            requested_capability: "workspace_os.status",
          },
        ],
      },
      compound_capability_synthesis_readiness: {
        schema: "helix.compound_capability_synthesis_readiness.v1",
        applies: true,
        complete: false,
        has_failed_subgoal: true,
        support_refs: [catalogObservationRef],
        required_terminal_kind: "model_synthesized_answer",
        synthesis_terminal_kind: "model_synthesized_answer",
        synthesis_required: false,
      },
      capability_itinerary_execution_state: {
        applies: true,
        complete: false,
        required_observation_families: ["capability_catalog", "workspace_diagnostic"],
        missing_observation_families: ["workspace_diagnostic"],
        compound_subgoal_ledger: [
          {
            subgoal_id: catalogSubgoalId,
            requested_capability: "helix_ask.inspect_capability_catalog",
            selected_capability: "helix_ask.inspect_capability_catalog",
            executed_capability: "helix_ask.inspect_capability_catalog",
            observation_kind: "capability_registry",
            observation_ref: catalogObservationRef,
            satisfaction: "satisfied",
            rail_status: "complete",
          },
          {
            subgoal_id: workspaceSubgoalId,
            requested_capability: "workspace_os.status",
            selected_capability: "workspace_os.status",
            executed_capability: null,
            observation_kind: null,
            observation_ref: null,
            satisfaction: "missing",
            rail_status: "fail_closed",
            first_broken_rail: "observation_artifact",
            rail_failure_code: "required_observation_missing",
            repair_target: "observation_materializer",
          },
        ],
      },
      current_turn_artifact_ledger: artifacts,
      goal_satisfaction_evaluation: {
        satisfaction: "not_satisfied",
        next_decision: "continue",
      },
    };

    applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: artifacts,
    });

    expect(payload.final_answer_draft_selection).toMatchObject({
      blocked_reason: "compound_subgoal_incomplete",
      materialized_terminal_artifact_kind: null,
    });
    expect(payload.route_terminal_materialization).toMatchObject({
      materialization_ok: false,
      materialization_blocked_reason: "compound_subgoal_incomplete",
    });
  });

  it("recovers compound draft support coverage from ledger execution-state artifacts", () => {
    const turnId = "ask:test:compound-support-ledger-execution-state";
    const workspaceSubgoalId = `${turnId}:compound_capability_subgoal:1:workspace_os_status`;
    const docsSubgoalId = `${turnId}:compound_capability_subgoal:2:docs-viewer_locate_in_doc`;
    const workspaceObservationRef = `${turnId}:workspace_os_status_observation`;
    const docsObservationRef = `${turnId}:doc_location_matches`;
    const draftRef = `${turnId}:final_answer_draft`;
    const draftText = "Workspace status was available, and the requested document anchor was located.";
    const artifacts = [
      {
        artifact_id: `${turnId}:capability_itinerary_execution_state`,
        kind: "capability_itinerary_execution_state",
        payload: {
          schema: "helix.capability_itinerary_execution_state.v1",
          turn_id: turnId,
          applies: true,
          complete: true,
          compound_subgoal_ledger: [
            {
              subgoal_id: workspaceSubgoalId,
              requested_capability: "workspace_os.status",
              selected_capability: "workspace_os.status",
              executed_capability: "workspace_os.status",
              observation_kind: "workspace_os_status_observation",
              observation_ref: workspaceObservationRef,
              satisfaction: "satisfied",
              rail_status: "complete",
            },
            {
              subgoal_id: docsSubgoalId,
              requested_capability: "docs-viewer.locate_in_doc",
              selected_capability: "docs-viewer.locate_in_doc",
              executed_capability: "docs-viewer.locate_in_doc",
              observation_kind: "doc_location_matches",
              observation_ref: docsObservationRef,
              satisfaction: "satisfied",
              rail_status: "complete",
            },
          ],
          assistant_answer: false,
          raw_content_included: false,
        },
      },
      {
        artifact_id: workspaceObservationRef,
        kind: "workspace_os_status_observation",
        payload: {
          schema: "helix.workspace_os_status_observation.v1",
          capability_key: "workspace_os.status",
          compound_subgoal_id: workspaceSubgoalId,
        },
      },
      {
        artifact_id: docsObservationRef,
        kind: "doc_location_matches",
        payload: {
          schema: "helix.doc_location_matches.v1",
          capability_key: "docs-viewer.locate_in_doc",
          compound_subgoal_id: docsSubgoalId,
          matches: [{ path: "docs/helix-ask-codex-loop-discipline.md", line: 196 }],
        },
      },
      {
        artifact_id: draftRef,
        kind: "final_answer_draft",
        payload: {
          schema: "helix.final_answer_draft.v1",
          text: draftText,
          answer_text: draftText,
          support_refs: [workspaceObservationRef],
          artifact_refs: [workspaceObservationRef],
          authority: "llm_post_observation_compound_synthesis",
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        source_target: "model_only",
        allowed_terminal_artifact_kinds: ["model_synthesized_answer", "typed_failure"],
      },
      current_turn_artifact_ledger: artifacts,
      selected_final_answer: draftText,
      terminal_artifact_kind: "model_synthesized_answer",
      final_answer_source: "final_answer_draft",
      goal_satisfaction_evaluation: {
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("typed_failure");
    expect(payload.terminal_error_code).toBe("compound_subgoal_support_refs_missing");
    expect(payload.compound_subgoal_draft_support_coverage).toMatchObject({
      applies: true,
      ok: false,
      required_observation_refs: [workspaceObservationRef, docsObservationRef],
      draft_support_refs: [workspaceObservationRef],
      missing_observation_refs: [docsObservationRef],
    });
  });

  it("allows compound final drafts grounded in every satisfied subgoal observation", () => {
    const turnId = "ask:test:compound-draft-complete-subgoal-support";
    const workspaceSubgoalId = `${turnId}:compound_capability_subgoal:1:workspace_os_status`;
    const docsSubgoalId = `${turnId}:compound_capability_subgoal:2:docs-viewer_locate_in_doc`;
    const workspaceObservationRef = `${turnId}:workspace_os_status_observation`;
    const docsObservationRef = `${turnId}:doc_location_matches`;
    const draftText = "Workspace status was available, and the requested document anchor was located in the audit notes.";
    const artifacts = [
      {
        artifact_id: `${turnId}:runtime_tool_call:1`,
        kind: "runtime_tool_call",
        payload: {
          call_id: `${turnId}:runtime_tool_call:1`,
          capability_key: "workspace_os.status",
          compound_subgoal_id: workspaceSubgoalId,
          args: {},
        },
      },
      {
        artifact_id: `${turnId}:runtime_tool_call:1:runtime_tool_observation`,
        kind: "runtime_tool_observation",
        payload: {
          call_id: `${turnId}:runtime_tool_call:1`,
          capability_key: "workspace_os.status",
          compound_subgoal_id: workspaceSubgoalId,
          status: "completed",
        },
      },
      {
        artifact_id: workspaceObservationRef,
        kind: "workspace_os_status_observation",
        payload: {
          schema: "helix.workspace_os_status_observation.v1",
          capability_key: "workspace_os.status",
          compound_subgoal_id: workspaceSubgoalId,
          summary: { available: 18, degraded: 1 },
        },
      },
      {
        artifact_id: `${turnId}:runtime_tool_call:2`,
        kind: "runtime_tool_call",
        payload: {
          call_id: `${turnId}:runtime_tool_call:2`,
          capability_key: "docs-viewer.locate_in_doc",
          compound_subgoal_id: docsSubgoalId,
          args: { query: "terminal authority" },
        },
      },
      {
        artifact_id: `${turnId}:runtime_tool_call:2:runtime_tool_observation`,
        kind: "runtime_tool_observation",
        payload: {
          call_id: `${turnId}:runtime_tool_call:2`,
          capability_key: "docs-viewer.locate_in_doc",
          compound_subgoal_id: docsSubgoalId,
          status: "completed",
        },
      },
      {
        artifact_id: docsObservationRef,
        kind: "doc_location_matches",
        payload: {
          schema: "helix.doc_location_matches.v1",
          capability_key: "docs-viewer.locate_in_doc",
          compound_subgoal_id: docsSubgoalId,
          matches: [{ path: "docs/audits/research/helix-ask-codex-parity-model-turn-fidelity-audit-2026-06-12.md", line: 12 }],
        },
      },
      {
        artifact_id: `${turnId}:final_answer_draft`,
        kind: "final_answer_draft",
        payload: {
          schema: "helix.final_answer_draft.v1",
          text: draftText,
          support_refs: [workspaceObservationRef, docsObservationRef],
          artifact_refs: [workspaceObservationRef, docsObservationRef],
          authority: "llm_post_observation_composer",
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      active_prompt: "Use workspace_os.status, then use docs-viewer.locate_in_doc for terminal authority.",
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        source_target: "model_only",
        allowed_terminal_artifact_kinds: ["model_synthesized_answer", "typed_failure"],
        forbidden_terminal_artifact_kinds: ["workspace_action_receipt", "agent_step_observation_packet"],
        assistant_answer: false,
        raw_content_included: false,
      },
      canonical_goal_frame: {
        goal_kind: "compound_tool",
        required_terminal_kind: "model_synthesized_answer",
      },
      capability_itinerary: {
        schema: "helix.capability_itinerary.v1",
        prompt_shape: "compound_tool",
        relevant_tool_families: ["workspace_diagnostic", "docs_viewer"],
        terminal_success_criteria: {
          required_observation_families: ["workspace_diagnostic", "docs_viewer"],
          required_capabilities: ["workspace_os.status", "docs-viewer.locate_in_doc"],
          requires_post_observation_synthesis: true,
        },
        compound_capability_contract: {
          schema: "helix.compound_capability_contract.v1",
          turn_id: turnId,
          prompt_shape: "compound_capability",
          requires_all_subgoals: true,
          terminal_policy: "synthesize_from_satisfied_subgoal_observations",
          subgoals: [
            {
              subgoal_id: workspaceSubgoalId,
              order: 1,
              requested_capability: "workspace_os.status",
              runtime_capability: "workspace_os.status",
              required_observation_kinds: ["workspace_os_status_observation"],
              allowed_substitutions: [],
              args_hint: {},
            },
            {
              subgoal_id: docsSubgoalId,
              order: 2,
              requested_capability: "docs-viewer.locate_in_doc",
              runtime_capability: "docs-viewer.locate_in_doc",
              required_observation_kinds: ["doc_location_matches"],
              allowed_substitutions: [],
              args_hint: { query: "terminal authority" },
            },
          ],
          assistant_answer: false,
          raw_content_included: false,
        },
        assistant_answer: false,
        raw_content_included: false,
      },
      current_turn_artifact_ledger: artifacts,
      selected_final_answer: draftText,
      terminal_artifact_kind: "model_synthesized_answer",
      final_answer_source: "final_answer_draft",
      goal_satisfaction_evaluation: {
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("compound_evidence_synthesis_answer");
    expect(result.visible_text).toBe(draftText);
    expect(payload.compound_evidence_synthesis_answer).toMatchObject({
      schema: "helix.compound_evidence_synthesis_answer.v1",
      support_refs: [workspaceObservationRef, docsObservationRef],
      support_refs_count: 2,
      subgoal_observation_refs: [workspaceObservationRef, docsObservationRef],
      subgoal_observation_refs_count: 2,
      source_families: ["workspace_diagnostic", "docs_viewer"],
      model_step_capability: "model.synthesize_from_compound_subgoal_observations",
      final_answer_draft_ref: `${turnId}:final_answer_draft`,
    });
    expect(payload.compound_subgoal_draft_support_coverage).toMatchObject({
      applies: true,
      ok: true,
      required_observation_refs: [workspaceObservationRef, docsObservationRef],
      draft_support_refs: [workspaceObservationRef, docsObservationRef],
      missing_observation_refs: [],
    });
    expect(payload.final_answer_source).toBe("final_answer_draft");
    expect(payload.terminal_artifact_kind).toBe("compound_evidence_synthesis_answer");
  });

  it("refreshes a stale Minecraft itinerary and preserves a grounded guarded no-op terminal", () => {
    const turnId = "ask:test:minecraft-guarded-noop-terminal";
    const spatialCapability =
      "com.casimirbot.minecraft.spatial_region.inspect";
    const catalogCapability =
      "com.casimirbot.minecraft.command.catalog";
    const commandCapability = "com.casimirbot.minecraft.command";
    const spatialSubgoalId = `${turnId}:compound_capability_subgoal:1:spatial`;
    const catalogSubgoalId = `${turnId}:compound_capability_subgoal:2:catalog`;
    const commandSubgoalId = `${turnId}:compound_capability_subgoal:3:command`;
    const spatialObservationRef = `${turnId}:live_environment_observation:1`;
    const catalogObservationRef = `${turnId}:live_environment_observation:2`;
    const draftRef = `${turnId}:final_answer_draft`;
    const draftText =
      "I did not build the wall because the complete current-area survey verified no safe build-line candidate; no world mutation was performed.";
    const artifacts = [
      {
        artifact_id: spatialObservationRef,
        turn_id: turnId,
        kind: "live_environment_observation",
        source_scope: "current_turn_context",
        capability_key: spatialCapability,
        source_capability_id: spatialCapability,
        source_observation_schema:
          "helix.environment_connector.probe_observation.v1",
        status: "succeeded",
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
        payload: {
          schema: "helix.live_environment_observation.v1",
          kind: "live_environment_observation",
          status: "succeeded",
          capability_key: spatialCapability,
          source_capability_id: spatialCapability,
          observation_role: "evidence_not_assistant_answer",
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
          result: {
            purpose: "build_planning",
            build_line_candidates: [],
            build_line_candidates_complete: true,
            omitted_build_line_candidate_count: 0,
          },
        },
      },
      {
        artifact_id: catalogObservationRef,
        turn_id: turnId,
        kind: "live_environment_observation",
        source_scope: "current_turn_context",
        capability_key: catalogCapability,
        source_capability_id: catalogCapability,
        source_observation_schema:
          "helix.environment_command.catalog_observation.v1",
        status: "succeeded",
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
        payload: {
          schema: "helix.live_environment_observation.v1",
          kind: "live_environment_observation",
          status: "succeeded",
          capability_key: catalogCapability,
          source_capability_id: catalogCapability,
          observation_role: "evidence_not_assistant_answer",
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
          result: { command_count: 64 },
        },
      },
      {
        artifact_id: draftRef,
        kind: "final_answer_draft",
        payload: {
          schema: "helix.final_answer_draft.v1",
          text: draftText,
          support_refs: [spatialObservationRef, catalogObservationRef],
          artifact_refs: [spatialObservationRef, catalogObservationRef],
          authority: "llm_post_observation_composer",
        },
      },
    ];
    const capabilityItinerary = {
      schema: "helix.capability_itinerary.v1",
      turn_id: turnId,
      prompt_shape: "compound_tool",
      relevant_tool_families: ["live_environment"],
      terminal_success_criteria: {
        required_observation_families: ["live_environment"],
        required_capabilities: [
          spatialCapability,
          catalogCapability,
          commandCapability,
        ],
        requires_post_observation_synthesis: true,
      },
      compound_capability_contract: {
        schema: "helix.compound_capability_contract.v1",
        turn_id: turnId,
        prompt_shape: "compound_capability",
        requires_all_subgoals: true,
        terminal_policy: "synthesize_from_satisfied_subgoal_observations",
        subgoals: [
          {
            subgoal_id: spatialSubgoalId,
            order: 1,
            requested_capability: spatialCapability,
            runtime_capability: spatialCapability,
            required_args: [],
            required_observation_kinds: ["live_environment_observation"],
            allowed_substitutions: [],
            args_hint: { purpose: "structure_planning" },
          },
          {
            subgoal_id: catalogSubgoalId,
            order: 2,
            requested_capability: catalogCapability,
            runtime_capability: catalogCapability,
            required_args: [],
            required_observation_kinds: ["live_environment_observation"],
            allowed_substitutions: [],
            args_hint: {},
          },
          {
            subgoal_id: commandSubgoalId,
            order: 3,
            requested_capability: commandCapability,
            runtime_capability: commandCapability,
            required_args: ["command", "category", "effect"],
            required_observation_kinds: [
              "helix.environment_command.observation.v1",
            ],
            allowed_substitutions: [],
            args_hint: {},
            guarded_noop_policy: {
              schema: "helix.compound_capability_guarded_noop.v1",
              mode: "no_verified_safe_candidate",
              guard_subgoal_id: spatialSubgoalId,
              guard_capability: spatialCapability,
              required_purpose: "structure_planning",
              accepted_observation_purposes: [
                "structure_planning",
                "build_planning",
              ],
              candidate_field: "build_line_candidates",
              completeness_field: "build_line_candidates_complete",
              omitted_count_field: "omitted_build_line_candidate_count",
              current_turn_only: true,
              requires_successful_observation: true,
              user_directed_noop_guard: true,
            },
          },
        ],
        assistant_answer: false,
        raw_content_included: false,
      },
      execution_state: {
        complete: false,
        missing_required_capabilities: [commandCapability],
        missing_compound_subgoal_ids: [commandSubgoalId],
      },
      assistant_answer: false,
      raw_content_included: false,
    };
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      active_prompt:
        "Build the wall only if a safe site is verified. If no safe site is verified, do not build.",
      source_target_intent: {
        target_source: "live_environment",
        target_kind: "live_environment",
        strength: "hard",
      },
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        source_target: "live_environment",
        allowed_terminal_artifact_kinds: [
          "compound_evidence_synthesis_answer",
          "typed_failure",
        ],
        forbidden_terminal_artifact_kinds: [
          "agent_step_observation_packet",
        ],
        assistant_answer: false,
        raw_content_included: false,
      },
      canonical_goal_frame: {
        goal_kind: "compound_evidence_synthesis",
        required_terminal_kind: "compound_evidence_synthesis_answer",
      },
      capability_itinerary: capabilityItinerary,
      capability_itinerary_execution_state: capabilityItinerary.execution_state,
      current_turn_artifact_ledger: artifacts,
      selected_final_answer: draftText,
      terminal_artifact_kind: "model_synthesized_answer",
      final_answer_source: "final_answer_draft",
      goal_satisfaction_evaluation: {
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: artifacts,
    });

    expect(payload.terminal_error_code).toBeUndefined();
    expect(result.selected_terminal_artifact_kind).toBe(
      "compound_evidence_synthesis_answer",
    );
    expect(result.visible_text).toBe(draftText);
    expect(payload.capability_itinerary_execution_state).toMatchObject({
      complete: true,
      missing_required_capabilities: [],
      missing_compound_subgoal_ids: [],
      compound_subgoal_ledger: [
        { requested_capability: spatialCapability, satisfaction: "satisfied" },
        { requested_capability: catalogCapability, satisfaction: "satisfied" },
        {
          requested_capability: commandCapability,
          satisfaction: "satisfied",
          satisfaction_reason: "no_verified_safe_candidate",
          satisfied_without_execution: true,
          mutation_performed: false,
          observation_ref: spatialObservationRef,
        },
      ],
    });
  });

  it.each([
    {
      label: "all compound observations selected",
      includeSecondObservation: true,
      expectedKind: "compound_evidence_synthesis_answer",
      expectedError: undefined,
    },
    {
      label: "one compound observation omitted",
      includeSecondObservation: false,
      expectedKind: "typed_failure",
      expectedError: "compound_subgoal_support_refs_missing",
    },
  ])("materializes provider compound synthesis when $label", ({
    includeSecondObservation,
    expectedKind,
    expectedError,
  }) => {
    const turnId = `ask:test:provider-compound-route-product:${includeSecondObservation ? "complete" : "missing"}`;
    const workspaceSubgoalId = `${turnId}:subgoal:workspace`;
    const moralSubgoalId = `${turnId}:subgoal:moral`;
    const workspaceObservationRef = `${turnId}:workspace_os_status_observation`;
    const moralObservationRef = `${turnId}:moral_graph_reflection`;
    const selectedObservationRefs = includeSecondObservation
      ? [workspaceObservationRef, moralObservationRef]
      : [workspaceObservationRef];
    const answerText = "Workspace status and Moral Graph observations were jointly interpreted, with diagnostic boundaries preserved.";
    const executionState = {
      schema: "helix.capability_itinerary_execution_state.v1",
      turn_id: turnId,
      applies: true,
      complete: true,
      required_observation_families: ["workspace_diagnostic", "moral_graph"],
      missing_observation_families: [],
      compound_subgoal_ledger: [
        {
          subgoal_id: workspaceSubgoalId,
          requested_capability: "workspace_os.status",
          selected_capability: "workspace_os.status",
          executed_capability: "workspace_os.status",
          observation_kind: "workspace_os_status_observation",
          observation_ref: workspaceObservationRef,
          satisfaction: "satisfied",
          rail_status: "complete",
        },
        {
          subgoal_id: moralSubgoalId,
          requested_capability: "moral-graph.reflect_context",
          selected_capability: "moral-graph.reflect_context",
          executed_capability: "moral-graph.reflect_context",
          observation_kind: "moral_graph_reflection",
          observation_ref: moralObservationRef,
          satisfaction: "satisfied",
          rail_status: "complete",
        },
      ],
      assistant_answer: false,
      raw_content_included: false,
    };
    const artifacts = [
      {
        artifact_id: `${turnId}:capability_itinerary_execution_state`,
        kind: "capability_itinerary_execution_state",
        payload: executionState,
      },
      {
        artifact_id: workspaceObservationRef,
        kind: "workspace_os_status_observation",
        payload: {
          schema: "helix.workspace_os_status_observation.v1",
          turn_id: turnId,
          capability_key: "workspace_os.status",
          compound_subgoal_id: workspaceSubgoalId,
          status: "succeeded",
        },
      },
      {
        artifact_id: moralObservationRef,
        kind: "moral_graph_reflection",
        payload: {
          schema: "helix.moral_graph_reflection_observation.v1",
          turn_id: turnId,
          capability_key: "moral-graph.reflect_context",
          compound_subgoal_id: moralSubgoalId,
          status: "succeeded",
        },
      },
    ];
    const providerCandidateRef = `${turnId}:agent_provider_terminal_candidate:codex:compound`;
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      active_prompt: "Check workspace status, reflect through the Moral Graph, and synthesize what both observations support.",
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        source_target: "visual_capture",
        required_terminal_kind: "image_lens_observation_report",
        allowed_terminal_artifact_kinds: ["image_lens_observation_report", "typed_failure"],
      },
      route_evidence_authority: {
        schema: "helix.route_evidence_authority.v1",
        turn_id: turnId,
        terminal_product_allowed: true,
        required_terminal_kind: "image_lens_observation_report",
        allowed_terminal_artifact_kinds: ["image_lens_observation_report", "typed_failure"],
        forbidden_terminal_artifact_kinds: [],
      },
      canonical_goal_frame: {
        schema: "helix.canonical_goal_frame.v1",
        turn_id: turnId,
        source: "codex_provider_capability_lane_terminal_authority",
        goal_kind: "image_lens_region_inspection",
        requested_capability: "visual_analysis.inspect_image_region",
        required_terminal_kind: "image_lens_observation_report",
      },
      compound_capability_contract: {
        schema: "helix.compound_capability_contract.v1",
        turn_id: turnId,
        prompt_shape: "compound_capability",
        requires_all_subgoals: true,
        terminal_policy: "synthesize_from_satisfied_subgoal_observations",
        subgoals: [
          {
            subgoal_id: workspaceSubgoalId,
            capability_family: "workspace_diagnostic",
            requested_capability: "workspace_os.status",
          },
          {
            subgoal_id: moralSubgoalId,
            capability_family: "moral_graph",
            requested_capability: "moral-graph.reflect_context",
          },
        ],
      },
      capability_itinerary_execution_state: executionState,
      current_turn_artifact_ledger: artifacts,
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        thread_id: "thread:test",
        turn_id: turnId,
        route: "/ask",
        terminal_kind: "answer",
        final_answer_source: "agent_provider_terminal_candidate",
        terminal_artifact_kind: "agent_provider_terminal_candidate",
        terminal_item_id: providerCandidateRef,
        server_authoritative: true,
        terminal_eligible: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        turn_id: turnId,
        concise_text: answerText,
        terminal_artifact_kind: "agent_provider_terminal_candidate",
        final_answer_source: "agent_provider_terminal_candidate",
        terminal_authority_ref: providerCandidateRef,
        selected_observation_refs: selectedObservationRefs,
        assistant_answer: false,
        raw_content_included: false,
      },
      provider_terminal_candidate: {
        schema: "helix.agent_provider_terminal_candidate.v1",
        candidate_id: providerCandidateRef,
        candidate_text: answerText,
        grounded_in_observation_refs: selectedObservationRefs,
        normalized_observation_refs: selectedObservationRefs,
        evidence_reentry_required: true,
        provider_reasoning_completed: true,
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      },
      solver_continuation_observation: {
        schema: "helix.solver_continuation_observation.v1",
        required_next_step: "model.direct_answer",
      },
    };

    if (includeSecondObservation) {
      payload.workstation_gateway_call_results = [
        {
          schema: "helix.workstation_tool_gateway.call_result.v1",
          ok: false,
          capability_id: "workspace_os.status",
          error: "schema_validation_failed",
          gateway_admission: {
            admission_status: "admitted",
            requested_capability: "workspace_os.status",
          },
          observation: {
            schema: "helix.environment_connector.probe_observation.v1",
            capability_id: "workspace_os.status",
            outcome: "schema_validation_failed",
            summary:
              "The probe arguments failed the trusted schema at $.center.",
            reentry_required: true,
            answer_authority: false,
            assistant_answer: false,
            terminal_eligible: false,
          },
        },
      ];
      payload.tool_rail_failure_triage = {
        schema: "helix.tool_rail_failure_triage.v1",
        rail_status: "fail_closed",
        rail_failure_code: "schema_validation_failed",
        first_broken_rail: "capability_execution",
        repair_target: "subgoal_argument_extraction",
        selected_capability: "workspace_os.status",
        executed_capability: null,
      };
      payload.terminal_artifact_kind = "typed_failure";
      payload.final_answer_source = "typed_failure";
      payload.terminal_error_code = "schema_validation_failed";
      payload.terminal_failure_text =
        "The probe arguments failed the trusted schema at $.center.";
      payload.selected_final_answer =
        "The probe arguments failed the trusted schema at $.center.";
    }

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe(expectedKind);
    expect(payload.terminal_artifact_kind).toBe(expectedKind);
    expect(payload.terminal_error_code).toBe(expectedError);
    if (includeSecondObservation) {
      expect(result.visible_text).toBe(answerText);
      expect(payload.provider_route_product_materialization).toMatchObject({
        materialized_terminal_artifact_kind: "compound_evidence_synthesis_answer",
        selected_observation_refs: [workspaceObservationRef, moralObservationRef],
        status: "materialized",
      });
      expect(payload.provider_route_product_compound_support_coverage).toMatchObject({
        applies: true,
        ok: true,
        missing_observation_refs: [],
      });
      expect(result.integrity).toMatchObject({
        provider_route_product_materialized: true,
        provider_route_product_can_surface: true,
        provider_route_product_superseded_repaired_compound_tool_failure: true,
      });
    } else {
      expect(payload.provider_route_product_compound_support_coverage).toMatchObject({
        applies: true,
        ok: false,
        missing_observation_refs: [moralObservationRef],
      });
      expect(String(payload.selected_final_answer)).toContain("provider-authored terminal synthesis");
    }
  });

  it("allows a grounded compound draft after a repairable gateway attempt is superseded", () => {
    const turnId = "ask:test:compound-calculator-support-aliases";
    const workspaceSubgoalId = `${turnId}:compound_capability_subgoal:1:workspace_os_status`;
    const calculatorSubgoalId = `${turnId}:compound_capability_subgoal:2:scientific-calculator_solve_expression`;
    const workspaceObservationRef = `${turnId}:workspace_os_status_observation`;
    const calculatorReceiptRef = `${turnId}:calculator_subgoal_receipt:calculate_expression`;
    const calculatorCoverageRef = `${turnId}:calculator_plan_coverage`;
    const workstationEvaluationRef = `${turnId}:runtime_calculator_workstation_tool_evaluation`;
    const draftText = "Workspace status was inspected, and the calculator-backed result is 330.";
    const artifacts = [
      {
        artifact_id: `${turnId}:runtime_tool_call:1`,
        kind: "runtime_tool_call",
        payload: {
          call_id: `${turnId}:runtime_tool_call:1`,
          capability_key: "workspace_os.status",
          compound_subgoal_id: workspaceSubgoalId,
          args: {},
        },
      },
      {
        artifact_id: `${turnId}:runtime_tool_call:1:runtime_tool_observation`,
        kind: "runtime_tool_observation",
        payload: {
          call_id: `${turnId}:runtime_tool_call:1`,
          capability_key: "workspace_os.status",
          compound_subgoal_id: workspaceSubgoalId,
          status: "completed",
        },
      },
      {
        artifact_id: workspaceObservationRef,
        kind: "workspace_os_status_observation",
        payload: {
          schema: "helix.workspace_os_status_observation.v1",
          capability_key: "workspace_os.status",
          compound_subgoal_id: workspaceSubgoalId,
        },
      },
      {
        artifact_id: `${turnId}:runtime_tool_call:2`,
        kind: "runtime_tool_call",
        payload: {
          call_id: `${turnId}:runtime_tool_call:2`,
          capability_key: "scientific-calculator.solve_expression",
          compound_subgoal_id: calculatorSubgoalId,
          args: { latex: "14*23+8" },
        },
      },
      {
        artifact_id: `${turnId}:runtime_tool_call:2:runtime_tool_observation`,
        kind: "runtime_tool_observation",
        payload: {
          call_id: `${turnId}:runtime_tool_call:2`,
          capability_key: "scientific-calculator.solve_expression",
          compound_subgoal_id: calculatorSubgoalId,
          status: "completed",
        },
      },
      {
        artifact_id: calculatorCoverageRef,
        kind: "calculator_plan_coverage",
        payload: {
          schema: "helix.calculator_plan_coverage.v1",
          coverage: "complete",
          receipt_refs: [calculatorReceiptRef],
        },
      },
      {
        artifact_id: workstationEvaluationRef,
        kind: "workstation_tool_evaluation",
        payload: {
          schema: "helix.workstation_tool_evaluation.v1",
          evaluation_id: workstationEvaluationRef,
          tool_key: "scientific-calculator.solve_expression",
          supports_goal: true,
          evidence_refs: [calculatorReceiptRef],
          receipt_ids: [calculatorReceiptRef],
          coverage_ref: calculatorCoverageRef,
          authority: "agent_runtime_loop",
        },
      },
      {
        artifact_id: `${turnId}:final_answer_draft`,
        kind: "final_answer_draft",
        payload: {
          schema: "helix.final_answer_draft.v1",
          text: draftText,
          support_refs: [workspaceObservationRef, calculatorReceiptRef],
          artifact_refs: [workspaceObservationRef, calculatorReceiptRef, calculatorCoverageRef],
          receipt_refs: [calculatorReceiptRef],
          coverage_refs: [calculatorCoverageRef],
          authority: "llm_post_observation_composer",
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      active_prompt: "Use workspace_os.status, then calculate 14*23+8.",
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        source_target: "model_only",
        allowed_terminal_artifact_kinds: ["model_synthesized_answer", "typed_failure"],
        forbidden_terminal_artifact_kinds: ["workspace_action_receipt", "agent_step_observation_packet"],
        assistant_answer: false,
        raw_content_included: false,
      },
      canonical_goal_frame: {
        goal_kind: "compound_tool",
        required_terminal_kind: "model_synthesized_answer",
      },
      capability_itinerary: {
        schema: "helix.capability_itinerary.v1",
        prompt_shape: "compound_tool",
        relevant_tool_families: ["workspace_diagnostic", "calculator"],
        terminal_success_criteria: {
          required_observation_families: ["workspace_diagnostic", "calculator"],
          required_capabilities: ["workspace_os.status", "scientific-calculator.solve_expression"],
          requires_post_observation_synthesis: true,
        },
        compound_capability_contract: {
          schema: "helix.compound_capability_contract.v1",
          turn_id: turnId,
          prompt_shape: "compound_capability",
          requires_all_subgoals: true,
          terminal_policy: "synthesize_from_satisfied_subgoal_observations",
          subgoals: [
            {
              subgoal_id: workspaceSubgoalId,
              order: 1,
              requested_capability: "workspace_os.status",
              runtime_capability: "workspace_os.status",
              required_observation_kinds: ["workspace_os_status_observation"],
              allowed_substitutions: [],
              args_hint: {},
            },
            {
              subgoal_id: calculatorSubgoalId,
              order: 2,
              requested_capability: "scientific-calculator.solve_expression",
              runtime_capability: "scientific-calculator.solve_expression",
              required_observation_kinds: ["calculator_receipt", "workstation_tool_evaluation"],
              allowed_substitutions: [],
              args_hint: { latex: "14*23+8", expression: "14*23+8" },
            },
          ],
          assistant_answer: false,
          raw_content_included: false,
        },
        assistant_answer: false,
        raw_content_included: false,
      },
      workstation_gateway_call_results: [
        {
          schema: "helix.workstation_tool_gateway.call_result.v1",
          ok: false,
          capability_id: "scientific-calculator.solve_expression",
          error: "invalid_arg:expression",
          gateway_admission: {
            requested_capability: "scientific-calculator.solve_expression",
            admission_status: "admitted",
          },
          observation: {
            status: "blocked",
            terminal_eligible: false,
            assistant_answer: false,
          },
          tool_followup_decision: {
            next_action: "repair",
            reason: "invalid_arg:expression",
            observation_summary:
              "The first calculator request had an invalid expression argument.",
          },
        },
      ],
      current_turn_artifact_ledger: artifacts,
      selected_final_answer: draftText,
      terminal_artifact_kind: "model_synthesized_answer",
      final_answer_source: "final_answer_draft",
      goal_satisfaction_evaluation: {
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("compound_evidence_synthesis_answer");
    expect(result.source).toBe("final_answer_draft");
    expect(payload.compound_evidence_synthesis_answer).toMatchObject({
      schema: "helix.compound_evidence_synthesis_answer.v1",
      support_refs: expect.arrayContaining([workspaceObservationRef, calculatorReceiptRef]),
      subgoal_observation_refs: [workspaceObservationRef, workstationEvaluationRef],
      subgoal_observation_refs_count: 2,
      source_families: ["workspace_diagnostic", "calculator"],
      model_step_capability: "model.synthesize_from_compound_subgoal_observations",
    });
    expect(payload.compound_subgoal_draft_support_coverage).toMatchObject({
      applies: true,
      ok: true,
      required_observation_refs: [workspaceObservationRef, workstationEvaluationRef],
      missing_observation_refs: [],
    });
    expect(payload.final_answer_source).toBe("final_answer_draft");
    expect(payload.terminal_error_code).toBeUndefined();
  });

  it("selects a grounded compound draft over a later diagnostic failure draft", () => {
    const turnId = "ask:test:compound-good-draft-over-stale-failure-draft";
    const catalogSubgoalId = `${turnId}:compound_capability_subgoal:1:helix_ask_inspect_capability_catalog`;
    const workspaceSubgoalId = `${turnId}:compound_capability_subgoal:2:workspace_os_status`;
    const catalogObservationRef = `${turnId}:runtime_tool_call:1:capability_registry`;
    const workspaceObservationRef = `${turnId}:runtime_tool_call:2:workspace_os_status_observation`;
    const goodDraftRef = `${turnId}:final_answer_draft:good`;
    const staleFailureDraftRef = `${turnId}:final_answer_draft:stale_failure`;
    const goodDraftText =
      "The capability catalog reports 59 active dynamic workstation actions and 91 retired actions. The workstation status reports 19 available actions, 0 degraded actions, 3 blocked actions, 0 errors, and 12 unknown actions.";
    const staleFailureDraftText =
      "The goal of calling `helix_ask.inspect_capability_catalog` and then using `workspace_os.status` was not satisfied due to missing required artifacts.";
    const artifacts = [
      {
        artifact_id: `${turnId}:runtime_tool_call:1`,
        kind: "runtime_tool_call",
        payload: {
          call_id: `${turnId}:runtime_tool_call:1`,
          capability_key: "helix_ask.inspect_capability_catalog",
          compound_subgoal_id: catalogSubgoalId,
          args: {},
        },
      },
      {
        artifact_id: `${turnId}:runtime_tool_call:1:runtime_tool_observation`,
        kind: "runtime_tool_observation",
        payload: {
          call_id: `${turnId}:runtime_tool_call:1`,
          capability_key: "helix_ask.inspect_capability_catalog",
          compound_subgoal_id: catalogSubgoalId,
          status: "completed",
        },
      },
      {
        artifact_id: catalogObservationRef,
        kind: "capability_registry",
        payload: {
          schema: "helix.capability_registry.v1",
          artifact_id: catalogObservationRef,
          capability_key: "helix_ask.inspect_capability_catalog",
          compound_subgoal_id: catalogSubgoalId,
          active_dynamic_actions: 59,
          retired_actions: 91,
          assistant_answer: false,
          raw_content_included: false,
        },
      },
      {
        artifact_id: `${turnId}:runtime_tool_call:2`,
        kind: "runtime_tool_call",
        payload: {
          call_id: `${turnId}:runtime_tool_call:2`,
          capability_key: "workspace_os.status",
          compound_subgoal_id: workspaceSubgoalId,
          args: {},
        },
      },
      {
        artifact_id: `${turnId}:runtime_tool_call:2:runtime_tool_observation`,
        kind: "runtime_tool_observation",
        payload: {
          call_id: `${turnId}:runtime_tool_call:2`,
          capability_key: "workspace_os.status",
          compound_subgoal_id: workspaceSubgoalId,
          status: "completed",
        },
      },
      {
        artifact_id: workspaceObservationRef,
        kind: "workspace_os_status_observation",
        payload: {
          schema: "helix.workspace_os_status_observation.v1",
          artifact_id: workspaceObservationRef,
          capability_key: "workspace_os.status",
          compound_subgoal_id: workspaceSubgoalId,
          available_count: 19,
          degraded_count: 0,
          blocked_count: 3,
          error_count: 0,
          unknown_count: 12,
          assistant_answer: false,
          raw_content_included: false,
        },
      },
      {
        artifact_id: goodDraftRef,
        kind: "final_answer_draft",
        payload: {
          schema: "helix.final_answer_draft.v1",
          kind: "final_answer_draft",
          artifact_id: goodDraftRef,
          text: goodDraftText,
          required_terminal_kind: "model_synthesized_answer",
          support_refs: [catalogObservationRef, workspaceObservationRef],
          artifact_refs: [catalogObservationRef, workspaceObservationRef],
          authority: "llm_post_observation_composer",
          assistant_answer: false,
          raw_content_included: false,
        },
      },
      {
        artifact_id: staleFailureDraftRef,
        kind: "final_answer_draft",
        payload: {
          schema: "helix.final_answer_draft.v1",
          kind: "final_answer_draft",
          artifact_id: staleFailureDraftRef,
          text: staleFailureDraftText,
          required_terminal_kind: "model_synthesized_answer",
          support_refs: [catalogObservationRef, workspaceObservationRef],
          artifact_refs: [catalogObservationRef, workspaceObservationRef],
          authority: "llm_post_observation_composer",
          assistant_answer: false,
          raw_content_included: false,
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      active_prompt: "Call helix_ask.inspect_capability_catalog, then use workspace_os.status to inspect workstation status.",
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        source_target: "runtime_evidence",
        allowed_terminal_artifact_kinds: ["model_synthesized_answer", "typed_failure"],
        forbidden_terminal_artifact_kinds: ["capability_registry", "workspace_os_status_observation"],
        assistant_answer: false,
        raw_content_included: false,
      },
      canonical_goal_frame: {
        goal_kind: "runtime_capability_catalog",
        required_terminal_kind: "capability_help_summary",
      },
      capability_itinerary: {
        schema: "helix.capability_itinerary.v1",
        prompt_shape: "compound_tool",
        terminal_success_criteria: {
          required_capabilities: ["helix_ask.inspect_capability_catalog", "workspace_os.status"],
          required_observation_families: ["capability_catalog", "workspace_diagnostic"],
          requires_post_observation_synthesis: true,
          compound_terminal_policy: "synthesize_from_satisfied_subgoal_observations",
          allowed_terminal_artifact_kinds: ["model_synthesized_answer", "typed_failure"],
        },
        compound_capability_contract: {
          schema: "helix.compound_capability_contract.v1",
          turn_id: turnId,
          requires_all_subgoals: true,
          terminal_policy: "synthesize_from_satisfied_subgoal_observations",
          subgoals: [
            {
              subgoal_id: catalogSubgoalId,
              order: 1,
              requested_capability: "helix_ask.inspect_capability_catalog",
              runtime_capability: "helix_ask.inspect_capability_catalog",
              required_observation_kinds: ["capability_registry"],
              terminal_contribution_kind: "model_synthesized_answer",
            },
            {
              subgoal_id: workspaceSubgoalId,
              order: 2,
              requested_capability: "workspace_os.status",
              runtime_capability: "workspace_os.status",
              required_observation_kinds: ["workspace_os_status_observation"],
              terminal_contribution_kind: "model_synthesized_answer",
            },
          ],
          assistant_answer: false,
          raw_content_included: false,
        },
        execution_state: {
          applies: true,
          complete: true,
          compound_subgoal_ledger: [
            {
              subgoal_id: catalogSubgoalId,
              requested_capability: "helix_ask.inspect_capability_catalog",
              selected_capability: "helix_ask.inspect_capability_catalog",
              executed_capability: "helix_ask.inspect_capability_catalog",
              observation_kind: "capability_registry",
              observation_ref: catalogObservationRef,
              satisfaction: "satisfied",
              rail_status: "complete",
            },
            {
              subgoal_id: workspaceSubgoalId,
              requested_capability: "workspace_os.status",
              selected_capability: "workspace_os.status",
              executed_capability: "workspace_os.status",
              observation_kind: "workspace_os_status_observation",
              observation_ref: workspaceObservationRef,
              satisfaction: "satisfied",
              rail_status: "complete",
            },
          ],
        },
        assistant_answer: false,
        raw_content_included: false,
      },
      capability_itinerary_execution_state: {
        applies: true,
        complete: true,
        required_observation_families: ["capability_catalog", "workspace_diagnostic"],
        missing_observation_families: [],
        compound_subgoal_ledger: [
          {
            subgoal_id: catalogSubgoalId,
            requested_capability: "helix_ask.inspect_capability_catalog",
            selected_capability: "helix_ask.inspect_capability_catalog",
            executed_capability: "helix_ask.inspect_capability_catalog",
            observation_kind: "capability_registry",
            observation_ref: catalogObservationRef,
            satisfaction: "satisfied",
            rail_status: "complete",
          },
          {
            subgoal_id: workspaceSubgoalId,
            requested_capability: "workspace_os.status",
            selected_capability: "workspace_os.status",
            executed_capability: "workspace_os.status",
            observation_kind: "workspace_os_status_observation",
            observation_ref: workspaceObservationRef,
            satisfaction: "satisfied",
            rail_status: "complete",
          },
        ],
      },
      compound_capability_contract: {
        schema: "helix.compound_capability_contract.v1",
        turn_id: turnId,
        terminal_policy: "synthesize_from_satisfied_subgoal_observations",
        subgoals: [
          {
            subgoal_id: catalogSubgoalId,
            requested_capability: "helix_ask.inspect_capability_catalog",
          },
          {
            subgoal_id: workspaceSubgoalId,
            requested_capability: "workspace_os.status",
          },
        ],
      },
      compound_capability_synthesis_readiness: {
        schema: "helix.compound_capability_synthesis_readiness.v1",
        applies: true,
        complete: true,
        required_terminal_kind: "model_synthesized_answer",
        synthesis_terminal_kind: "model_synthesized_answer",
        synthesis_required: true,
      },
      current_turn_artifact_ledger: artifacts,
      goal_satisfaction_evaluation: {
        satisfaction: "not_satisfied",
        next_decision: "continue",
      },
      tool_turn_chain_audit: {
        schema: "helix.tool_turn_chain_audit.v1",
        rail_status: "fail_closed",
        rail_failure_code: "terminal_not_materialized",
        first_broken_rail: "terminal_materialization",
        repair_target: "terminal_materializer",
        required_terminal_kind: "model_synthesized_answer",
      },
      solver_continuation_observation: {
        schema: "helix.solver_continuation_observation.v1",
        required_next_step: "model.direct_answer",
      },
      selected_final_answer: "I could not produce a terminal answer for this turn.",
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
      terminal_error_code: "terminal_answer_unavailable",
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("compound_evidence_synthesis_answer");
    expect(result.source).toBe("final_answer_draft");
    expect(result.visible_text).toBe(goodDraftText);
    expect(result.visible_text).not.toBe(staleFailureDraftText);
    expect(result.integrity.compound_materialized_draft_can_satisfy_terminal).toBe(true);
    expect(payload.compound_evidence_synthesis_answer).toMatchObject({
      schema: "helix.compound_evidence_synthesis_answer.v1",
      text: goodDraftText,
      final_answer_draft_ref: goodDraftRef,
      support_refs: [catalogObservationRef, workspaceObservationRef],
      subgoal_observation_refs: [catalogObservationRef, workspaceObservationRef],
    });
    expect(payload.final_answer_source).toBe("final_answer_draft");
    expect(payload.terminal_artifact_kind).toBe("compound_evidence_synthesis_answer");
    expect(payload.terminal_error_code).toBeUndefined();
    expect(payload.final_answer_draft_selection).toMatchObject({
      selected_final_answer_draft_ref: goodDraftRef,
      materialized_terminal_artifact_kind: "compound_evidence_synthesis_answer",
    });
  });

  it("materializes docs-plus-calculator compound synthesis from satisfied doc subgoal refs", () => {
    const turnId = "ask:test:docs-calculator-compound-doc-ref-synthesis";
    const docsSubgoalId = `${turnId}:compound_capability_subgoal:1:docs-viewer_locate_in_doc`;
    const calculatorSubgoalId = `${turnId}:compound_capability_subgoal:2:scientific-calculator_solve_expression`;
    const docObservationRef = `${turnId}:agent_runtime_2_docs_viewer_locate_in_doc:doc_location_matches:1`;
    const calculatorObservationRef = `${turnId}:agent_runtime_3_scientific_calculator_solve_expression:calculator_receipt:1`;
    const compoundLedger = [
      {
        subgoal_id: docsSubgoalId,
        order: 1,
        requested_capability: "docs-viewer.locate_in_doc",
        runtime_capability: "docs-viewer.locate_in_doc",
        selected_capability: "docs-viewer.locate_in_doc",
        executed_capability: "docs-viewer.locate_in_doc",
        observation_kind: "doc_location_matches",
        observation_ref: docObservationRef,
        satisfaction: "satisfied",
        terminal_contribution_kind: "doc_location_matches",
        rail_status: "complete",
        assistant_answer: false,
        raw_content_included: false,
      },
      {
        subgoal_id: calculatorSubgoalId,
        order: 2,
        requested_capability: "scientific-calculator.solve_expression",
        runtime_capability: "scientific-calculator.solve_expression",
        selected_capability: "scientific-calculator.solve_expression",
        executed_capability: "scientific-calculator.solve_expression",
        observation_kind: "calculator_receipt",
        observation_ref: calculatorObservationRef,
        satisfaction: "satisfied",
        terminal_contribution_kind: "workstation_tool_evaluation",
        rail_status: "complete",
        assistant_answer: false,
        raw_content_included: false,
      },
    ];
    const artifacts = [
      {
        artifact_id: docObservationRef,
        kind: "doc_location_matches",
        source_scope: "current_turn",
        payload: {
          schema: "helix.doc_location_matches.v1",
          artifact_id: docObservationRef,
          capability_key: "docs-viewer.locate_in_doc",
          compound_subgoal_id: docsSubgoalId,
          status: "located",
          match_count: 1,
          matches: [
            {
              ref: docObservationRef,
              path: "docs/helix-ask-turn-solver-spine.md",
              start_line: 30,
              end_line: 34,
              snippet: "Only the completed solver path may answer.",
            },
          ],
          assistant_answer: false,
          raw_content_included: false,
        },
      },
      {
        artifact_id: calculatorObservationRef,
        kind: "calculator_receipt",
        payload: {
          schema: "helix.calculator_receipt.v1",
          artifact_id: calculatorObservationRef,
          capability_key: "scientific-calculator.solve_expression",
          compound_subgoal_id: calculatorSubgoalId,
          expression: "19 + 23",
          result: 42,
          assistant_answer: false,
          raw_content_included: false,
        },
      },
      {
        artifact_id: `${turnId}:direct_answer_text`,
        kind: "direct_answer_text",
        payload: {
          schema: "helix.direct_answer_text.v1",
          artifact_id: `${turnId}:direct_answer_text`,
          text: "The docs location and calculation are complete.",
          assistant_answer: false,
          raw_content_included: false,
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      active_prompt:
        "Use docs-viewer.locate_in_doc to find where terminal authority is discussed, then call scientific-calculator.solve_expression with this exact expression: 19 + 23.",
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        route_family: "docs_source",
        source_target: "docs_viewer",
        allowed_terminal_artifact_kinds: [
          "final_answer_draft",
          "compound_evidence_synthesis_answer",
          "model_synthesized_answer",
          "doc_evidence_synthesis_answer",
          "typed_failure",
        ],
        forbidden_terminal_artifact_kinds: [
          "doc_location_matches",
          "calculator_receipt",
          "workstation_tool_evaluation",
          "direct_answer_text",
        ],
        assistant_answer: false,
        raw_content_included: false,
      },
      canonical_goal_frame: {
        goal_kind: "locate_in_doc",
        required_terminal_kind: "doc_location_matches",
      },
      capability_itinerary: {
        schema: "helix.capability_itinerary.v1",
        prompt_shape: "compound_tool",
        terminal_success_criteria: {
          required_capabilities: [
            "docs-viewer.locate_in_doc",
            "scientific-calculator.solve_expression",
          ],
          required_observation_families: ["docs_viewer", "calculator"],
          requires_post_observation_synthesis: true,
          compound_terminal_policy: "synthesize_from_satisfied_subgoal_observations",
          allowed_terminal_artifact_kinds: [
            "final_answer_draft",
            "compound_evidence_synthesis_answer",
            "model_synthesized_answer",
            "doc_evidence_synthesis_answer",
            "typed_failure",
          ],
        },
        compound_capability_contract: {
          schema: "helix.compound_capability_contract.v1",
          turn_id: turnId,
          requires_all_subgoals: true,
          terminal_policy: "synthesize_from_satisfied_subgoal_observations",
          subgoals: [
            {
              subgoal_id: docsSubgoalId,
              order: 1,
              requested_capability: "docs-viewer.locate_in_doc",
              runtime_capability: "docs-viewer.locate_in_doc",
              required_observation_kinds: [
                "doc_location_result",
                "doc_location_matches",
                "doc_evidence_location",
              ],
              terminal_contribution_kind: "doc_location_matches",
            },
            {
              subgoal_id: calculatorSubgoalId,
              order: 2,
              requested_capability: "scientific-calculator.solve_expression",
              runtime_capability: "scientific-calculator.solve_expression",
              required_observation_kinds: ["calculator_receipt", "workstation_tool_evaluation"],
              terminal_contribution_kind: "workstation_tool_evaluation",
            },
          ],
          assistant_answer: false,
          raw_content_included: false,
        },
        execution_state: {
          applies: true,
          complete: true,
          compound_subgoal_ledger: compoundLedger,
        },
        assistant_answer: false,
        raw_content_included: false,
      },
      capability_itinerary_execution_state: {
        schema: "helix.capability_itinerary_execution_state.v1",
        applies: true,
        complete: true,
        required_observation_families: ["docs_viewer", "calculator"],
        missing_observation_families: [],
        compound_subgoal_ledger: compoundLedger,
        assistant_answer: false,
        raw_content_included: false,
      },
      compound_capability_contract: {
        schema: "helix.compound_capability_contract.v1",
        turn_id: turnId,
        requires_all_subgoals: true,
        terminal_policy: "synthesize_from_satisfied_subgoal_observations",
        subgoals: [
          {
            subgoal_id: docsSubgoalId,
            requested_capability: "docs-viewer.locate_in_doc",
          },
          {
            subgoal_id: calculatorSubgoalId,
            requested_capability: "scientific-calculator.solve_expression",
          },
        ],
      },
      compound_subgoal_rail_statuses: compoundLedger,
      current_turn_artifact_ledger: artifacts,
      selected_final_answer: "I could not produce a terminal answer for this turn.",
      terminal_artifact_kind: "workstation_tool_evaluation",
      final_answer_source: "workstation_tool_evaluation",
    };
    const answerBlockedArtifacts = structuredClone(artifacts);
    const answerBlockedPayload = structuredClone(payload);
    answerBlockedPayload.agent_continuation_state = {
      schema: "helix.agent_continuation_state.v1",
      goal: {
        status: "needs_user_input",
        satisfied: false,
        terminal_product_allowed: false,
      },
      missing_requirement_ids: ["com.casimirbot.minecraft.command"],
      allowed_decisions: ["ask_user", "fail"],
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("doc_evidence_synthesis_answer");
    expect(result.selected_terminal_artifact_ref).toBe(`${turnId}:doc_evidence_synthesis_answer:from_final_answer_draft`);
    expect(payload.terminal_artifact_kind).toBe("doc_evidence_synthesis_answer");
    expect(payload.final_answer_source).toBe("final_answer_draft");
    expect(payload.terminal_error_code).toBeUndefined();
    expect(payload.ledger_backed_compound_final_answer_draft).toMatchObject({
      terminal_artifact_kind: "doc_evidence_synthesis_answer",
      subgoal_observation_refs: [docObservationRef, calculatorObservationRef],
    });
    expect(payload.doc_evidence_synthesis_coverage).toMatchObject({
      sufficient: true,
      observed_artifact_refs: [docObservationRef],
      missing_requirements: [],
      support_refs_count: expect.any(Number),
    });
    expect(payload.doc_evidence_synthesis_answer).toMatchObject({
      terminal_artifact_kind: "doc_evidence_synthesis_answer",
      support_refs: expect.arrayContaining([docObservationRef, calculatorObservationRef]),
    });

    const answerBlockedResult = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload: answerBlockedPayload,
      artifactLedger: answerBlockedArtifacts,
    });
    expect(
      answerBlockedPayload.ledger_backed_compound_final_answer_draft_applied,
    ).not.toBe(true);
    expect(answerBlockedPayload.ledger_backed_compound_final_answer_draft).toBeUndefined();
    expect(answerBlockedResult.selected_terminal_artifact_kind).not.toBe(
      "doc_evidence_synthesis_answer",
    );
  });

  it("fails closed with typed affordance diagnostics when calculator bindings are missing", () => {
    const turnId = "ask:test:typed-affordance-binding-blocked";
    const hallucinatedSolve = "The calculator result is 59.67 Pa.";
    const artifacts = [
      {
        artifact_id: `${turnId}:draft`,
        kind: "final_answer_draft",
        payload: {
          schema: "helix.final_answer_draft.v1",
          turn_id: turnId,
          text: hallucinatedSolve,
          answer_text: hallucinatedSolve,
          assistant_answer: false,
          raw_content_included: false,
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      selected_final_answer: hallucinatedSolve,
      answer: hallucinatedSolve,
      text: hallucinatedSolve,
      terminal_artifact_kind: "model_synthesized_answer",
      final_answer_source: "final_answer_draft",
      compound_dependency_turn_plan: {
        schema: "helix.compound_capability_dependency_turn_plan.v1",
        turn_id: turnId,
        rail_status: "blocked",
        ordered_subgoals: [
          {
            subgoal_id: "research_quantify_reflect:theory_reflection",
            ordinal: 1,
            requested_capability: "theory-badge-graph.reflect_discussion_context",
            executed_capability: "theory-badge-graph.reflect_discussion_context",
            satisfied: true,
            rail_status: "satisfied",
          },
          {
            subgoal_id: "research_quantify_reflect:calculator_bound_expression",
            ordinal: 2,
            requested_capability: "scientific-calculator.solve_expression",
            executed_capability: null,
            dependency_binding: "typed_affordance_bound_calculator_expression",
            required_affordance_kinds: [
              "calculator_expression_template",
              "numeric_value_evidence",
              "bound_calculator_expression",
            ],
            missing_variables: ["n_m3", "T_eV"],
            rejected_expression: "p_Pa = n_m3*T_eV*e_charge",
            satisfied: false,
            rail_status: "blocked_by_dependency",
          },
        ],
        typed_affordance_binding: {
          schema: "helix.compound_typed_affordance_binding.v1",
          status: "blocked",
          reason: "missing_numeric_value_evidence",
          rejected_expression: "p_Pa = n_m3*T_eV*e_charge",
          normalized_expression: "n_m3*T_eV*e_charge",
          missing_variables: ["n_m3", "T_eV"],
          selected_affordances: [
            {
              kind: "calculator_expression_template",
              ref: "theory-badge:tokamak.plasma.thermal_pressure_proxy",
            },
          ],
        },
        first_broken_rail: {
          subgoal_id: "research_quantify_reflect:calculator_bound_expression",
          capability_id: "scientific-calculator.solve_expression",
          reason: "missing_numeric_value_evidence",
          missing_variables: ["n_m3", "T_eV"],
          rejected_expression: "p_Pa = n_m3*T_eV*e_charge",
        },
        assistant_answer: false,
        raw_content_included: false,
      },
      current_turn_artifact_ledger: artifacts,
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("typed_failure");
    expect(payload.terminal_artifact_kind).toBe("typed_failure");
    expect(payload.final_answer_source).toBe("typed_failure");
    expect(payload.terminal_error_code).toBe("missing_numeric_value_evidence");
    expect(payload.selected_final_answer).toContain("missing typed affordance bindings");
    expect(payload.selected_final_answer).toContain("n_m3, T_eV");
    expect(payload.selected_final_answer).not.toBe(hallucinatedSolve);
    expect(payload.typed_failure).toMatchObject({
      error_code: "missing_numeric_value_evidence",
      first_broken_rail: "typed_affordance_binding",
      repair_target: "affordance_binder",
      selected_capability: "scientific-calculator.solve_expression",
      missing_variables: ["n_m3", "T_eV"],
      required_affordance_kinds: [
        "calculator_expression_template",
        "numeric_value_evidence",
        "bound_calculator_expression",
      ],
      rejected_expression: "p_Pa = n_m3*T_eV*e_charge",
      normalized_expression: "n_m3*T_eV*e_charge",
    });
    expect(payload.terminal_presentation).toMatchObject({
      terminal_artifact_kind: "typed_failure",
      concise_text: expect.stringContaining("n_m3, T_eV"),
    });
  });

  it("reports an executed scholarly fetch failure instead of inventing a typed-affordance failure", () => {
    const turnId = "ask:test:scholarly-fetch-http-403";
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      selected_final_answer: "Unsupported stale answer",
      answer: "Unsupported stale answer",
      text: "Unsupported stale answer",
      terminal_artifact_kind: "model_synthesized_answer",
      final_answer_source: "final_answer_draft",
      compound_dependency_turn_plan: {
        schema: "helix.compound_capability_dependency_turn_plan.v1",
        turn_id: turnId,
        rail_status: "blocked",
        ordered_subgoals: [
          {
            subgoal_id: "scholarly_research_workflow:scholarly_full_text",
            requested_capability: "scholarly-research.fetch_full_text",
            selected_capability: "scholarly-research.fetch_full_text",
            executed_capability: null,
            satisfied: false,
            rail_status: "missing_observation",
            rail_failure_code: "full_text_http_403",
          },
        ],
        first_broken_rail: {
          subgoal_id: "scholarly_research_workflow:scholarly_full_text",
          requested_capability: "scholarly-research.fetch_full_text",
          selected_capability: "scholarly-research.fetch_full_text",
          rail_status: "missing_observation",
          rail_failure_code: "full_text_http_403",
        },
        assistant_answer: false,
        raw_content_included: false,
      },
      tool_rail_failure_triage: {
        schema: "helix.tool_rail_failure_triage.v1",
        rail_status: "fail_closed",
        rail_failure_code: "observation_missing",
        first_broken_rail: "observation_artifact",
        repair_target: "observation_materializer",
        selected_capability: "scholarly-research.fetch_full_text",
        executed_capability: "scholarly-research.fetch_full_text",
        compound_incomplete_subgoal_did_tool_run: true,
        compound_rail_failure_code: "full_text_http_403",
        compound_first_broken_rail: "capability_execution",
        compound_repair_target: "tool_result_reentry",
        first_incomplete_compound_requested_capability: "scholarly-research.fetch_full_text",
        first_incomplete_compound_selected_capability: "scholarly-research.fetch_full_text",
        first_incomplete_compound_executed_capability: "scholarly-research.fetch_full_text",
      },
      current_turn_artifact_ledger: [],
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: [],
    });

    expect(result.selected_terminal_artifact_kind).toBe("typed_failure");
    expect(payload.terminal_error_code).toBe("full_text_http_403");
    expect(payload.selected_final_answer).toContain("full_text_http_403");
    expect(payload.selected_final_answer).not.toContain("typed affordance");
    expect(payload.typed_failure).toMatchObject({
      error_code: "full_text_http_403",
      first_broken_rail: "capability_execution",
      repair_target: "tool_result_reentry",
      selected_capability: "scholarly-research.fetch_full_text",
      executed_capability: "scholarly-research.fetch_full_text",
    });
  });

  it("materializes a goal-supported visual artifact whose canonical text is top-level", () => {
    const turnId = "ask:test:top-level-visual-context-text";
    const visualRef = `${turnId}:situation_context_question:situation_evidence_selection`;
    const answerText = "The current visual capture shows File Explorer open to a research folder.";
    const visualArtifact = {
      artifact_id: visualRef,
      kind: "situation_context_pack",
      text: answerText,
      answer_text: answerText,
      assistant_answer: false,
      raw_content_included: false,
    };
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      canonical_goal_frame: {
        schema: "helix.canonical_goal_frame.v1",
        turn_id: turnId,
        goal_kind: "situation_context_question",
        required_terminal_kind: "visual_context_pack",
      },
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        required_terminal_kind: "visual_context_pack",
        allowed_terminal_artifact_kinds: [
          "visual_context_pack",
          "situation_context_pack",
          "visual_frame_evidence",
          "typed_failure",
        ],
      },
      goal_satisfaction_evaluation: {
        schema: "helix.goal_satisfaction_evaluation.v1",
        turn_id: turnId,
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
        observed_results: [{
          ref: visualRef,
          kind: "situation_context_pack",
          status: "observed",
          supports_goal: true,
          reason: "satisfies_goal_terminal_contract",
        }],
      },
      current_turn_artifact_ledger: [visualArtifact],
      agent_runtime_loop: {
        schema: "helix.agent_runtime_loop.v1",
        iterations: [
          {
            iteration: 1,
            decision_id: `${turnId}:decision:visual`,
            decision_authority: "llm",
            decision_timing: "pre_tool",
            next_step: "tool",
            chosen_capability: "situation-room.describe_visual_capture",
            observed_artifact_refs: [visualRef],
            tool_observation: {
              kind: "situation_context_pack",
              artifact_id: visualRef,
            },
          },
          {
            iteration: 2,
            decision_id: `${turnId}:decision:answer`,
            decision_authority: "llm",
            decision_timing: "post_observation",
            next_step: "answer",
            chosen_capability: "model.direct_answer",
            observed_artifact_refs: [visualRef],
          },
        ],
      },
      agent_step_decision: {
        schema: "helix.agent_step_decision.v1",
        decision_id: `${turnId}:decision:answer`,
        decision_authority: "llm",
        decision_timing: "post_observation",
        next_step: "answer",
        chosen_capability: "model.direct_answer",
      },
      terminal_authority_single_writer: {
        schema: "helix.terminal_authority_single_writer_result.v1",
        selected_terminal_artifact_kind: "tool_receipt",
        visible_text: "Visual capture completed.",
      },
    };

    expect(shouldRefreshHelixTerminalAuthorityAfterSatisfiedGoal({
      payload,
      artifactLedger: [visualArtifact],
    })).toBe(true);

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: [visualArtifact],
    });

    expect(result.selected_terminal_artifact_kind).toBe("situation_context_pack");
    expect(result.selected_terminal_artifact_ref).toBe(visualRef);
    expect(result.visible_text).toBe(answerText);
    expect(payload.terminal_artifact_kind).toBe("situation_context_pack");
    expect(payload.final_answer_source).toBe("situation_context_pack");
    expect(payload.selected_final_answer).toBe(answerText);
    expect(payload.terminal_error_code).toBeUndefined();
  });

  it("does not let the single writer publish a comparison when execution-closure synthesis is blocked", async () => {
    const turnId = "ask:test:single-writer-closure-synthesis-blocked";
    const answerText =
      "Candidate A is the best-supported scientific answer and should be preferred over candidate B.";
    const fixture = await buildTheoryExecutionClosureTerminalFixture({
      turnId,
      semanticReady: false,
    });
    const closureArtifact = fixture.closureArtifact;
    const finalDraftRef = `${turnId}:final_answer_draft`;
    const selectedTerminalRef = `${turnId}:model_synthesized_answer:from_final_answer_draft`;
    const finalDraftArtifact = {
      artifact_id: finalDraftRef,
      kind: "final_answer_draft",
      payload: {
        schema: "helix.final_answer_draft.v1",
        artifact_id: finalDraftRef,
        text: answerText,
        answer_text: answerText,
        authority: "llm_post_observation_composer",
        support_refs: [closureArtifact.artifact_id],
        assistant_answer: false,
        raw_content_included: false,
      },
    };
    const selectedTerminalArtifact = {
      artifact_id: selectedTerminalRef,
      kind: "model_synthesized_answer",
      payload: {
        schema: "helix.model_synthesized_answer.v1",
        artifact_id: selectedTerminalRef,
        turn_id: turnId,
        terminal_artifact_kind: "model_synthesized_answer",
        text: answerText,
        answer_text: answerText,
        support_refs: [closureArtifact.artifact_id],
        final_answer_draft_ref: finalDraftRef,
        assistant_answer: false,
        raw_content_included: false,
      },
    };
    const artifacts = [
      ...fixture.artifacts,
      finalDraftArtifact,
      selectedTerminalArtifact,
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      terminal_artifact_kind: "model_synthesized_answer",
      terminal_artifact_id: selectedTerminalRef,
      final_answer_source: "final_answer_draft",
      selected_final_answer: answerText,
      model_synthesized_answer: selectedTerminalArtifact.payload,
      current_turn_artifact_ledger: artifacts,
      canonical_goal_frame: {
        schema: "helix.canonical_goal_frame.v1",
        goal_kind: "tool_request",
        required_terminal_kind: "model_synthesized_answer",
      },
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        source_target: "theory_locator",
        required_terminal_kind: "model_synthesized_answer",
        allowed_terminal_artifact_kinds: [
          "model_synthesized_answer",
          "typed_failure",
        ],
      },
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("typed_failure");
    expect(result.visible_text).not.toContain("should be preferred");
    expect(payload.terminal_error_code).toBe(
      "theory_execution_closure_synthesis_blocked",
    );
    expect(payload.selected_final_answer).toContain(
      "candidate_set_incomparable",
    );
    expect(payload.visible_answer_policy_faithfulness_rejection).toMatchObject({
      schema: "helix.visible_answer_policy_faithfulness_rejection.v1",
      violation: "theory_execution_closure_synthesis_blocked",
      repairable: false,
      retry_required: false,
      retry_exhausted: false,
    });
    expect(result.rejected_candidates).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: "visible_answer_policy_repair_required",
        }),
      ]),
    );
  });

  it("exposes one repairable execution-closure policy retry and then stops at the typed failure", async () => {
    const turnId = "ask:test:single-writer-closure-policy-retry-bounded";
    const answerText = [
      "This theory is proven true.",
      "Formal proof remains open.",
      "Numerical verification remains open.",
      "Empirical measurement remains open.",
      "Lanyon artifact execution remains open.",
      "Graph congruence remains open.",
      "Derivation equations remain open.",
      "Observable grounding remains open.",
      "Coordinate frame alignment remains open.",
      "Unit dimensions remain open.",
      "Boundary and initial conditions remain open.",
      "Source provenance remains open.",
      "Candidate comparability remains open.",
    ].join(" ");
    const fixture = await buildTheoryExecutionClosureTerminalFixture({
      turnId,
      semanticReady: true,
    });
    const closureArtifact = fixture.closureArtifact;
    const readiness = fixture.closure.synthesisReadiness as Record<
      string,
      unknown
    >;
    const requiredSupportRefs = Array.isArray(readiness.requiredSupportRefs)
      ? (readiness.requiredSupportRefs as string[])
      : [];
    const supportRefs = [
      String(closureArtifact.artifact_id),
      ...requiredSupportRefs,
    ];
    const finalDraftRef = `${turnId}:final_answer_draft`;
    const selectedTerminalRef = `${turnId}:model_synthesized_answer:from_final_answer_draft`;
    const finalDraftArtifact = {
      artifact_id: finalDraftRef,
      kind: "final_answer_draft",
      payload: {
        schema: "helix.final_answer_draft.v1",
        artifact_id: finalDraftRef,
        text: answerText,
        answer_text: answerText,
        authority: "llm_post_observation_composer",
        support_refs: supportRefs,
        assistant_answer: false,
        raw_content_included: false,
      },
    };
    const selectedTerminalArtifact = {
      artifact_id: selectedTerminalRef,
      kind: "model_synthesized_answer",
      payload: {
        schema: "helix.model_synthesized_answer.v1",
        artifact_id: selectedTerminalRef,
        turn_id: turnId,
        terminal_artifact_kind: "model_synthesized_answer",
        text: answerText,
        answer_text: answerText,
        support_refs: supportRefs,
        final_answer_draft_ref: finalDraftRef,
        assistant_answer: false,
        raw_content_included: false,
      },
    };
    const artifacts = [
      ...fixture.artifacts,
      finalDraftArtifact,
      selectedTerminalArtifact,
    ];
    const makePayload = (): Record<string, unknown> => ({
      turn_id: turnId,
      thread_id: "thread:test",
      terminal_artifact_kind: "model_synthesized_answer",
      terminal_artifact_id: selectedTerminalRef,
      final_answer_source: "final_answer_draft",
      selected_final_answer: answerText,
      model_synthesized_answer: selectedTerminalArtifact.payload,
      current_turn_artifact_ledger: artifacts,
      canonical_goal_frame: {
        schema: "helix.canonical_goal_frame.v1",
        goal_kind: "tool_request",
        required_terminal_kind: "model_synthesized_answer",
      },
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        source_target: "theory_locator",
        required_terminal_kind: "model_synthesized_answer",
        allowed_terminal_artifact_kinds: [
          "model_synthesized_answer",
          "typed_failure",
        ],
      },
    });

    const firstPayload = makePayload();
    const first = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload: firstPayload,
      artifactLedger: artifacts,
    });

    expect(first.selected_terminal_artifact_kind).toBe("typed_failure");
    expect(
      firstPayload.visible_answer_policy_faithfulness_rejection,
    ).toMatchObject({
      violation: "theory_execution_closure_physical_truth_overclaim",
      repairable: true,
      retry_required: true,
      retry_attempts_consumed: 0,
      retry_attempt_limit: 1,
      retry_exhausted: false,
    });
    expect(first.rejected_candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "model_synthesized_answer",
          reason: "visible_answer_policy_repair_required",
        }),
      ]),
    );

    const repeatedPayload = makePayload();
    repeatedPayload.visible_answer_policy_terminal_retry = {
      schema: "helix.visible_answer_policy_terminal_retry.v1",
      turn_id: turnId,
      attempt_count: 1,
      attempt_limit: 1,
      violation: "theory_execution_closure_physical_truth_overclaim",
      status: "attempting",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    };
    const repeated = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload: repeatedPayload,
      artifactLedger: artifacts,
    });

    expect(repeated.selected_terminal_artifact_kind).toBe("typed_failure");
    expect(repeatedPayload.terminal_error_code).toBe(
      "theory_execution_closure_physical_truth_overclaim",
    );
    expect(
      repeatedPayload.visible_answer_policy_faithfulness_rejection,
    ).toMatchObject({
      repairable: true,
      retry_required: false,
      retry_attempts_consumed: 1,
      retry_attempt_limit: 1,
      retry_exhausted: true,
    });
    expect(repeated.rejected_candidates).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: "visible_answer_policy_repair_required",
        }),
      ]),
    );
  });

  it("preserves a current-turn authoritative typed blocker after required observations re-enter", () => {
    const turnId = "ask:test:authoritative-observation-blocker";
    const blockerText =
      "The scientific image evidence re-entered, but no promoted exact equation row exists yet.";
    const artifacts = [makePostToolObservation(turnId)];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      ok: false,
      response_type: "final_failure",
      final_status: "final_failure",
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
      terminal_error_code: "scientific_image_exact_row_promotion_missing",
      terminal_failure_text: blockerText,
      selected_final_answer: blockerText,
      answer: blockerText,
      text: blockerText,
      typed_failure: {
        schema: "helix.typed_failure.v1",
        error_code: "scientific_image_exact_row_promotion_missing",
        message: blockerText,
        text: blockerText,
        answer_text: blockerText,
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        thread_id: "thread:test",
        turn_id: turnId,
        route: "/ask/turn",
        terminal_kind: "failure",
        final_answer_source: "typed_failure",
        terminal_artifact_kind: "typed_failure",
        terminal_item_id: `${turnId}:typed_failure:scientific_image_exact_row_promotion_missing`,
        terminal_text_preview: blockerText,
        server_authoritative: true,
        terminal_eligible: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        required_terminal_kind: "model_synthesized_answer",
        allowed_terminal_artifact_kinds: [
          "model_synthesized_answer",
          "typed_failure",
        ],
      },
      canonical_goal_frame: {
        schema: "helix.canonical_goal_frame.v1",
        goal_kind: "scientific_image_theory_reflection",
        required_terminal_kind: "model_synthesized_answer",
      },
      current_turn_artifact_ledger: artifacts,
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("typed_failure");
    expect(payload.terminal_error_code).toBe(
      "scientific_image_exact_row_promotion_missing",
    );
    expect(payload.selected_final_answer).toBe(blockerText);
    expect(payload.selected_final_answer).not.toMatch(
      /post-tool model step|itinerary observations|solver continuation/i,
    );
  });
});
